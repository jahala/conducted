/**
 * @feature WS-03 Setup script in a terminal
 * Owns: tests of the new workspace's setup timeline in its first, empty chat, over the real
 * container.
 * Test first: a failed setup offers "Setup script failed — fix it?", which sends the fix request to
 * the workspace's chat.
 */

import type { SessionConfig } from "@conducted/protocol";
import { ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { SetupRun } from "../../core/services/workspace.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { SetupTimeline } from "./SetupTimeline.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
	active?.close();
	active = undefined;
});

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const wrap = (test: TestContainer, child: ReactNode) => (
	<ServicesProvider container={test.container}>
		<AppProviders client={createQueryClient(() => {})}>{child}</AppProviders>
	</ServicesProvider>
);

async function setup(options: { run?: Partial<SetupRun>; chat?: boolean; failed?: boolean } = {}) {
	const test = createTestContainer();
	active = test;
	const repo = await seedRepo(test.container, { name: "atlas" });
	test.memory.controls.files.set(
		`${repo.rootPath}/.conducted/settings.toml`,
		'[scripts]\nsetup = "pnpm install"\n',
	);
	await test.container.services.repo.loadConfig(repo.id);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		directoryName: "oslo",
		branch: "sam/oslo",
	});
	// A new row starts as initializing; the timeline shows a made workspace, or a failed one.
	test.container.services.workspace.store.setState((state) => ({
		workspacesById: {
			...state.workspacesById,
			[workspace.id]: { ...workspace, state: options.failed === true ? "failed" : "ready" },
		},
	}));
	let session: { id: SessionId } | null = null;
	if (options.chat !== false) {
		const created = await test.container.services.sessions.create(workspace.id, CONFIG);
		if (!created.ok) throw new Error(created.error.message);
		session = created.value;
	}
	// The open chat's pane has read the workspace's chats, as the app does on start.
	const started = await test.container.services.sessions.start();
	if (!started.ok) throw new Error(started.error.message);
	if (options.run !== undefined) {
		const run: SetupRun = {
			state: "completed",
			exitCode: null,
			terminalId: null,
			logPath: null,
			log: "missing",
			interruptedReason: null,
			...options.run,
		};
		test.container.services.workspace.store.setState((state) => ({
			setupRuns: { ...state.setupRuns, [workspace.id]: run },
		}));
	}
	render(wrap(test, <SetupTimeline workspaceId={workspace.id as WorkspaceId} />));
	return { test, workspace, session };
}

describe("WS-03 setup timeline in a new workspace's first chat", () => {
	it("names the copy, the folder and the copied files", async () => {
		await setup();

		expect(await screen.findByText(/You’re in a new copy of/)).toBeTruthy();
		expect(screen.getByText("atlas")).toBeTruthy();
		expect(screen.getAllByText("oslo").length).toBeGreaterThan(0);
	});

	it("says Setup did not start when the workspace could not be created", async () => {
		await setup({ failed: true });

		expect(await screen.findByText("Setup did not start")).toBeTruthy();
		expect(screen.getByText("Workspace initialization failed")).toBeTruthy();
	});

	it("offers Setup script failed — fix it?, which sends the fix request to the chat", async () => {
		const { test, session } = await setup({ run: { state: "failed", exitCode: 1 } });
		const send = vi.spyOn(test.container.actions.sessions, "send").mockResolvedValue(ok(undefined));

		fireEvent.click(await screen.findByRole("button", { name: "Setup script failed — fix it?" }));

		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0]?.[0]).toBe(session?.id as SessionId);
		expect(send.mock.calls[0]?.[1]).toContain("The setup script failed.");
	});

	// Conductor keeps the workspace ready when its setup script fails (main @1101155), so the
	// timeline reads the script's failure and never an initialization failure.
	it("shows a real failed setup run as the script's failure, on a ready workspace", async () => {
		const test = createTestContainer();
		active = test;
		const repo = await seedRepo(test.container, { name: "atlas" });
		test.memory.controls.files.set(
			`${repo.rootPath}/.conducted/settings.toml`,
			'[scripts]\nsetup = "pnpm install"\n',
		);
		await test.container.services.repo.loadConfig(repo.id);
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "oslo",
			branch: "sam/oslo",
		});
		const started = await test.container.services.sessions.start();
		if (!started.ok) throw new Error(started.error.message);
		test.memory.controls.queuePtyExit(1);

		const ran = await test.container.services.workspace.runSetup(workspace.id);
		render(wrap(test, <SetupTimeline workspaceId={workspace.id as WorkspaceId} />));

		expect(ran.ok).toBe(false);
		expect(
			test.container.services.workspace.store.getState().workspacesById[workspace.id]?.state,
		).toBe("ready");
		expect(
			await screen.findByRole("button", { name: "Setup script failed — fix it?" }),
		).toBeTruthy();
		expect(screen.queryByText("Workspace initialization failed")).toBeNull();
		expect(screen.queryByText("Setup did not start")).toBeNull();
	});

	it("says there is no chat to attach the logs to when the workspace has none", async () => {
		const error = vi.spyOn(toast, "error");
		await setup({ run: { state: "failed", exitCode: 1 }, chat: false });

		fireEvent.click(await screen.findByRole("button", { name: "Setup script failed — fix it?" }));

		await waitFor(() =>
			expect(error).toHaveBeenCalledWith("No active session to attach setup logs to"),
		);
	});
});
