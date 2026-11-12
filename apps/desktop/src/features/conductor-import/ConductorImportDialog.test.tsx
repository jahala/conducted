import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { conductorDatabasePath } from "../../core/conductor-import/plan.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { conductorChatRows, done, said, text, wrote } from "../../test/conductor-chat.ts";
import { buildConductorFixture } from "../../test/conductor-fixture.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { answerSidecar, type SidecarCall, sidecarRefuses } from "../../test/sidecar-answers.ts";
import { answerHistory } from "../../test/sidecar-history.ts";
import { ProjectStep } from "../onboarding/ProjectStep.tsx";
import { GeneralPage } from "../settings/pages/GeneralPage.tsx";

const SECRET = "ui-secret-value-789";

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	await test?.container.stop();
	test?.close();
	test = undefined;
});

function seed(mounted: TestContainer, withHistory = false): void {
	const home = mounted.container.platform.fs.paths.home;
	const root = `${home}/conductor/repos/alpha`;
	const worktree = `${home}/conductor/workspaces/alpha/oslo`;
	const { controls } = mounted.memory;
	controls.seedConductorDatabase(
		conductorDatabasePath(home),
		buildConductorFixture({
			repos: [{ id: "r-alpha", name: "alpha", root_path: root }],
			workspaces: [
				{
					local_id: "w-oslo",
					repository_id: "r-alpha",
					directory_name: "oslo",
					branch: "me/oslo",
					state: "ready",
				},
			],
			sessions: [
				{ id: "s-1", workspace_id: "w-oslo", agent_type: "claude", title: "Fix login" },
				...(withHistory
					? [{ id: "s-2", workspace_id: "w-oslo", agent_type: "codex", title: "Codex chat" }]
					: []),
			],
			session_messages: withHistory
				? [
						...conductorChatRows("s-1", [
							{ turnId: "t-1", rows: [said("Hi"), wrote(text("u-1", "Hello.")), wrote(done(""))] },
						]),
						...conductorChatRows("s-2", [{ turnId: "t-1", rows: [said("Hi Codex")] }], 50),
					]
				: [],
			env_vars: [{ key: "API_TOKEN", scope: "shared", context: "local", value: SECRET }],
			terminal_sessions: [{ session_id: "t-1", workspace_id: "w-oslo", cwd: "/tmp" }],
		}),
	);
	controls.addFolder(root);
	controls.addFolder(worktree);
	controls.scriptShell((command) => {
		if (command.program === "lsof") return ok({ exitCode: 1, stdout: "", stderr: "" });
		if (command.args.join(" ").endsWith("worktree list --porcelain")) {
			return ok({
				exitCode: 0,
				stdout: `worktree ${root}\nbranch refs/heads/main\n\nworktree ${worktree}\nbranch refs/heads/me/oslo\n`,
				stderr: "",
			});
		}
		return null;
	});
}

async function mount(
	view: "settings" | "onboarding",
	onFinish = () => {},
	withHistory = false,
	/**
	 * Starts the container with a sidecar that maps history, and sets the disk's free space.
	 * `answer` answers a request first when it returns a value.
	 */
	mapped?: { freeBytes: number; answer?: (call: SidecarCall) => unknown },
): Promise<TestContainer> {
	const mounted = createTestContainer();
	test = mounted;
	seed(mounted, withHistory);
	if (mapped !== undefined) {
		const history = answerHistory(() => ({}));
		answerSidecar(mounted, (call) => mapped.answer?.(call) ?? history(call));
		mounted.memory.controls.setDatabaseFreeBytes(mapped.freeBytes);
		const started = await mounted.container.start();
		if (!started.ok) throw new Error(started.error.message);
	}
	await mounted.container.services.settings.start();
	await mounted.container.services.conductorImport.start();
	render(
		<ServicesProvider container={mounted.container}>
			{view === "settings" ? <GeneralPage /> : <ProjectStep onFinish={onFinish} />}
		</ServicesProvider>,
	);
	return mounted;
}

describe("APP-17 the import from Conductor, on screen", () => {
	it("the dialog shows the dry run's counts and imports when the user goes ahead", async () => {
		const mounted = await mount("settings");
		expect(screen.getByText("Import from Conductor")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Review import" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(await dialog.findByText("Workspaces")).toBeTruthy();
		expect(dialog.getByText("Not brought over")).toBeTruthy();
		expect(dialog.getByText("terminal tabs (1)")).toBeTruthy();
		expect(document.body.textContent).not.toContain(SECRET);
		expect(mounted.memory.controls.secrets.size).toBe(0);

		fireEvent.click(dialog.getByRole("button", { name: "Import" }));

		expect(await dialog.findByText(/Imported 1 project, 1 workspace and 1 chat\./)).toBeTruthy();
		expect(
			mounted.container.services.workspace.store.getState().workspacesById["w-oslo"],
		).toBeTruthy();
		expect(document.body.textContent).not.toContain(SECRET);
	});

	it("cancelling drops the dry run and its copy", async () => {
		const mounted = await mount("settings");
		fireEvent.click(screen.getByRole("button", { name: "Review import" }));
		const dialog = within(await screen.findByRole("dialog"));
		await dialog.findByText("Workspaces");
		expect(mounted.memory.controls.conductorDatabases.size).toBe(2);

		fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

		await screen.findByRole("button", { name: "Review import" });
		await expect.poll(() => mounted.memory.controls.conductorDatabases.size).toBe(1);
		expect(
			mounted.container.services.workspace.store.getState().workspacesById["w-oslo"],
		).toBeUndefined();
	});

	it("first run offers the import when Conductor's data is on this Mac, and finishes after it", async () => {
		let finished = 0;
		await mount("onboarding", () => {
			finished++;
		});

		fireEvent.click(screen.getByRole("button", { name: "Import from Conductor" }));
		const dialog = within(await screen.findByRole("dialog"));
		await dialog.findByText("Workspaces");
		fireEvent.click(dialog.getByRole("button", { name: "Import" }));
		fireEvent.click(await dialog.findByRole("button", { name: "Done" }));

		expect(finished).toBe(1);
	});

	it("first run offers no import when Conductor's data is not here", async () => {
		const mounted = createTestContainer();
		test = mounted;
		await mounted.container.services.conductorImport.start();
		render(
			<ServicesProvider container={mounted.container}>
				<ProjectStep onFinish={() => {}} />
			</ServicesProvider>,
		);
		expect(screen.queryByRole("button", { name: "Import from Conductor" })).toBeNull();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
	});

	it("the dry run says which chats bring their history, and the outcome names a chat whose history failed", async () => {
		// The import's mapping of the Claude chat fails (the dry run's own mapping, whose id ends
		// in ":size", still works): the chat comes over without its history.
		await mount("settings", () => {}, true, {
			freeBytes: 50e9,
			answer: (call) =>
				call.method === "mapConductorHistory" && !String(call.params.historyId).endsWith(":size")
					? sidecarRefuses("The mapping stopped.")
					: undefined,
		});

		fireEvent.click(screen.getByRole("button", { name: "Review import" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(await dialog.findByText("Chat history")).toBeTruthy();
		expect(dialog.getByText("1 chat with its history (3 entries)")).toBeTruthy();
		expect(dialog.getByText("Codex: 1 chat (1 entry)")).toBeTruthy();
		expect(dialog.getByText(/History not brought: no mapping for this agent yet\./)).toBeTruthy();

		fireEvent.click(dialog.getByRole("button", { name: "Import" }));

		expect(await dialog.findByText(/Imported 1 project, 1 workspace and 2 chats\./)).toBeTruthy();
		expect(dialog.getByText(/History not brought for 1 chat\./)).toBeTruthy();
		expect(dialog.getByText(/Fix login: .*The mapping stopped\./)).toBeTruthy();
	});

	it("the dry run says the disk space chat history takes and the space free (D132)", async () => {
		await mount("settings", () => {}, true, { freeBytes: 50e9 });

		fireEvent.click(screen.getByRole("button", { name: "Review import" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(await dialog.findByText(/^Takes about \d+ MB of disk space$/)).toBeTruthy();
		expect(dialog.getByText("50.0 GB is free.")).toBeTruthy();
		expect(dialog.getByRole("button", { name: "Import" })).toBeTruthy();
	});

	it("a disk without the space says so with both numbers, and offers Try again in place of Import", async () => {
		await mount("settings", () => {}, true, { freeBytes: 1e9 });

		fireEvent.click(screen.getByRole("button", { name: "Review import" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(
			await dialog.findByText(
				/^There is not enough free disk space\. The import needs \d+\.\d GB free, and 1\.0 GB is free\. Free up space, then try again\.$/,
			),
		).toBeTruthy();
		expect(dialog.queryByRole("button", { name: "Import" })).toBeNull();
		expect(dialog.getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});
