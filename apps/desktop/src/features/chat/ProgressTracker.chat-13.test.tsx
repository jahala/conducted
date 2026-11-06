/**
 * @feature CHAT-13 Progress tracker
 * Owns: tests of the tracker above the composer over the real container: the current step and its
 * place, bars, text blocks, the empty and failed states, and a sidecar update reaching it.
 * Behaviour: ui-map.md 3.3 (bar, steps and text blocks; the current step with "· 2/5" and a
 * status colour), claude-runner.md 4.2.
 * Test first: steps [done, in_progress, pending] show the current step's label and "· 2/3".
 */
import type { SessionConfig } from "@conducted/protocol";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { ProgressTracker } from "./ProgressTracker.tsx";

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

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

async function setup() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { test, session, wrapper };
}

async function teardown(test: TestContainer): Promise<void> {
	cleanup();
	await test.container.stop();
	test.close();
}

afterEach(cleanup);

describe("CHAT-13 progress tracker", () => {
	it("names the current step and its place for done, in_progress and pending", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.setProgress(session.id, {
				blocks: [
					{
						kind: "steps",
						steps: [
							{ label: "Plan", status: "done" },
							{ label: "Build", status: "in_progress" },
							{ label: "Ship", status: "pending" },
						],
					},
				],
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("Build")).toBeTruthy();
			expect(screen.getByText("2/3")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("draws a title, bars and a text block from one update", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.setProgress(session.id, {
				title: "Migrating the API",
				blocks: [
					{ kind: "bar", label: "Files", value: 3, max: 10, detail: "3 of 10" },
					{ kind: "bar", label: "Tests", value: 1, max: 4 },
					{ kind: "text", text: "Watching the test run" },
				],
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("Migrating the API")).toBeTruthy();
			expect(screen.getAllByRole("progressbar")).toHaveLength(2);
			expect(screen.getByRole("progressbar", { name: "Files" }).getAttribute("aria-valuenow")).toBe(
				"3",
			);
			expect(screen.getByText("3 of 10")).toBeTruthy();
			expect(screen.getByText("Watching the test run")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("marks a failed step with the danger colour and the word Failed", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.setProgress(session.id, {
				blocks: [
					{
						kind: "steps",
						steps: [
							{ label: "Plan", status: "done" },
							{ label: "Run", status: "failed" },
							{ label: "Ship", status: "pending" },
						],
					},
				],
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("Run").className).toContain("text-danger");
			expect(screen.getByText("Failed").className).toContain("text-danger");
			expect(screen.getByText("2/3")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("says Done when every step is done", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.setProgress(session.id, {
				blocks: [
					{
						kind: "steps",
						steps: [
							{ label: "Plan", status: "done" },
							{ label: "Build", status: "done" },
						],
					},
				],
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("Done")).toBeTruthy();
			expect(screen.getByText("2/2")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("says No tasks for a steps block with no steps", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.setProgress(session.id, {
				blocks: [{ kind: "steps", steps: [] }],
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("No tasks")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("renders nothing when the chat has no progress", async () => {
		const { test, session, wrapper } = await setup();
		try {
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("region", { name: "Progress" })).toBeNull();
			expect(screen.queryByText("No tasks")).toBeNull();
		} finally {
			await teardown(test);
		}
	});

	it("shows an update the sidecar sends through the real container", async () => {
		const { test, session, wrapper } = await setup();
		try {
			must(await test.container.sidecar.start());
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "progress",
					params: {
						sessionId: session.id,
						progress: {
							title: "Building the change",
							blocks: [
								{
									kind: "steps",
									steps: [
										{ label: "Plan", status: "done" },
										{ label: "Write", status: "in_progress" },
									],
								},
							],
						},
					},
				}),
			);
			await waitFor(() => {
				expect(
					test.container.services.sessions.store.getState().progress[session.id],
				).toBeDefined();
			});
			render(<ProgressTracker sessionId={session.id} />, { wrapper });
			expect(screen.getByText("Building the change")).toBeTruthy();
			expect(screen.getByText("Write")).toBeTruthy();
			expect(screen.getByText("2/2")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});
});
