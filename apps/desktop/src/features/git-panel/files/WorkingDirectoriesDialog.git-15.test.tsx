/**
 * @feature GIT-15 Sparse checkout and the external diff tool
 * Owns: tests of the working directories picker over the real container and a scripted git.
 * Behaviour: Conductor's picker (renderApp @5688200 to @5695500).
 * Test first: deselecting a folder and saving sets the sparse checkout to the folders left.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { ShellCommand, ShellOutput } from "../../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import { WorkingDirectoriesButton, WorkingDirectoriesDialog } from "./WorkingDirectoriesDialog.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	active?.close();
	active = undefined;
});

const output = (stdout = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr: "", exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

async function setup(options: { sparse?: string; hold?: boolean } = {}) {
	const test = createTestContainer();
	active = test;
	const repo = await seedRepo(test.container, { rootPath: "/code/atlas" });
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		path: "/code/workspaces/atlas/oslo",
	});
	// The open workspace's panel has read its repository's settings, which git work needs.
	await test.container.services.repo.loadConfig(repo.id);
	const sets: string[][] = [];
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "git") return null;
		const args = argv(command);
		if (args[0] === "config" && args.at(-1) === "core.sparseCheckout") {
			return options.sparse === undefined ? output("", 1) : output("true\n");
		}
		if (args[0] === "sparse-checkout" && args[1] === "list") return output(options.sparse ?? "");
		if (args[0] === "ls-tree" && args.at(-1) === "apps/") {
			return output("apps/docs\napps/web\n");
		}
		if (args[0] === "ls-tree") {
			return options.hold === true ? new Promise(() => {}) : output("apps\npackages\nscripts\n");
		}
		if (args[0] === "sparse-checkout" && args[1] === "init") return output();
		if (args[0] === "sparse-checkout" && args[1] === "set") {
			sets.push([...args.slice(3)]);
			return output();
		}
		return null;
	});
	const onOpenChange = vi.fn();
	render(
		<ServicesProvider container={test.container}>
			<WorkingDirectoriesDialog
				open
				onOpenChange={onOpenChange}
				workspaceId={workspace.id as WorkspaceId}
			/>
		</ServicesProvider>,
	);
	return { sets, onOpenChange };
}

const option = (name: string | RegExp) => screen.findByRole("option", { name });

describe("GIT-15 working directories button", () => {
	it("opens the picker", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);
		render(
			<ServicesProvider container={test.container}>
				<WorkingDirectoriesButton workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Select working directories" }));

		expect(
			await screen.findByPlaceholderText(
				"Search directories or type a nested path like apps/web...",
			),
		).toBeTruthy();
	});
});

describe("GIT-15 working directories picker", () => {
	it("says Loading directories... while git lists them", async () => {
		await setup({ hold: true });

		expect(await screen.findByText("Loading directories...")).toBeTruthy();
		expect(
			screen.getByPlaceholderText("Search directories or type a nested path like apps/web..."),
		).toBeTruthy();
	});

	it("starts with every top-level folder chosen, and saves the folders left after a deselect", async () => {
		const { sets, onOpenChange } = await setup();
		const save = await screen.findByRole("button", { name: "Save" });
		expect((save as HTMLButtonElement).disabled).toBe(true);
		const group = await screen.findByRole("group", { name: "Working directories" });

		fireEvent.click(within(group).getByRole("option", { name: /scripts/ }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(sets).toEqual([["apps", "packages"]]));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("starts from the sparse checkout's folders when it is on", async () => {
		const { sets } = await setup({ sparse: "apps\n" });
		await option(/packages/);

		fireEvent.click(screen.getByRole("button", { name: "Select all" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(sets).toEqual([["apps", "packages", "scripts"]]));
	});

	it("deselects every folder the search shows with Deselect all", async () => {
		await setup();
		await option(/apps/);
		const select = screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement;
		expect(select.disabled).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));

		expect(select.disabled).toBe(false);
		expect(
			(screen.getByRole("button", { name: "Deselect all" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("lists the folders inside a typed nested path, and keeps one under a chosen folder locked", async () => {
		await setup({ sparse: "apps\n" });
		await option(/apps/);

		fireEvent.change(
			screen.getByPlaceholderText("Search directories or type a nested path like apps/web..."),
			{ target: { value: "apps/" } },
		);

		const web = await option(/apps\/web/);
		expect(web.getAttribute("aria-disabled")).toBe("true");
	});

	it("says No directories found when the search matches none", async () => {
		await setup();
		await option(/apps/);

		fireEvent.change(
			screen.getByPlaceholderText("Search directories or type a nested path like apps/web..."),
			{ target: { value: "zzz" } },
		);

		expect(await screen.findByText("No directories found")).toBeTruthy();
	});
});
