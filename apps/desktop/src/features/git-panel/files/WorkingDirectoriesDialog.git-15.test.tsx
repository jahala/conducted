/**
 * @feature GIT-15 Sparse checkout and the external diff tool
 * Owns: tests of the working directories picker over the real container and a scripted git.
 * Behaviour: Conductor's picker (renderApp @5688200 to @5695500).
 * Test first: deselecting a folder and saving sets the sparse checkout to the folders left.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../../app/providers.tsx";
import type { ChangedFile } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { ShellCommand, ShellOutput } from "../../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import {
	changedFolders,
	WorkingDirectoriesButton,
	WorkingDirectoriesDialog,
} from "./WorkingDirectoriesDialog.tsx";

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

/** An uncommitted change at `path`, as the Changes tab lists it. */
const change = (path: string): ChangedFile => ({
	path,
	status: "modified",
	linesAdded: 1,
	linesRemoved: 0,
	binary: false,
	conflicted: false,
	viewed: false,
});

async function setup(
	options: { sparse?: string; hold?: boolean; uncommitted?: readonly string[] } = {},
) {
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
	// seam: GIT-15 the uncommitted files come from the git service's own diff, tested in git.test.ts;
	// here they are the input the picker reads.
	vi.spyOn(test.container.services.git, "changedFiles").mockImplementation(async (_id, scope) =>
		ok(scope.kind === "uncommitted" ? (options.uncommitted ?? []).map(change) : []),
	);
	const onOpenChange = vi.fn();
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<WorkingDirectoriesDialog
					open
					onOpenChange={onOpenChange}
					workspaceId={workspace.id as WorkspaceId}
				/>
			</AppProviders>
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
				<AppProviders client={createQueryClient(() => {})}>
					<WorkingDirectoriesButton workspaceId={workspace.id} />
				</AppProviders>
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

	// Conductor locks a chosen folder that holds uncommitted changes, marks it, and says why
	// (renderApp @5693900); Deselect all keeps it (`D3o`).
	it("locks a chosen folder with uncommitted changes, and Deselect all keeps it", async () => {
		const { sets } = await setup({ uncommitted: ["packages/ui/button.ts"] });
		await waitFor(async () =>
			expect((await option(/packages/)).getAttribute("aria-disabled")).toBe("true"),
		);
		const packages = await option(/packages/);
		expect(packages.querySelector('[aria-label="Uncommitted changes"]')).not.toBeNull();
		fireEvent.focus(packages.parentElement as HTMLElement);
		expect(
			(
				await screen.findAllByText(
					"This directory has uncommitted changes. Commit or stash them before removing it.",
				)
			).length,
		).toBeGreaterThan(0);
		expect((await option(/apps/)).getAttribute("aria-disabled")).not.toBe("true");

		// The search shows apps and packages; scripts stays chosen, so packages must stay too.
		fireEvent.change(
			screen.getByPlaceholderText("Search directories or type a nested path like apps/web..."),
			{ target: { value: "a" } },
		);
		await waitFor(() => expect(screen.queryByRole("option", { name: /scripts/ })).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(sets).toHaveLength(1));
		expect([...(sets[0] ?? [])].sort()).toEqual(["packages", "scripts"]);
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

describe("GIT-15 changedFolders", () => {
	it("lists every folder that holds a changed file, at every depth", () => {
		expect([...changedFolders(["apps/web/src/a.ts", "README.md", "apps/docs/b.md"])]).toEqual([
			"apps",
			"apps/web",
			"apps/web/src",
			"apps/docs",
		]);
	});
});
