/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: tests of the Codex goal bar over the real container: a reported goal with its status,
 * Pause goal, Resume goal, Edit goal and Clear goal, the 'Goal' field and Save goal, the
 * "Enter a goal first." refusal, a goal read on mount, a chat that is not Codex, and Cmd+Enter
 * saving through the mounted command dispatcher.
 * Behaviour: ui-map.md 3.5 and 5.4.
 * Test first: Save with empty text shows "Enter a goal first."
 */
import type { CodexGoal, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import {
	answerSidecar,
	deliveredAsAsked,
	type SidecarCall,
	sidecarRefuses,
} from "../../test/sidecar-answers.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { GoalBar } from "./GoalBar.tsx";

const CODEX: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const activeGoal: CodexGoal = { objective: "Ship the importer", status: "active" };
const pausedGoal: CodexGoal = { objective: "Ship the importer", status: "paused" };

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let opened: TestContainer | null = null;

async function setup(
	options: { config?: Partial<SessionConfig>; answer?: (call: SidecarCall) => unknown } = {},
) {
	const test = createTestContainer();
	opened = test;
	const workspace = await seedWorkspace(test.container);
	const session = must(
		await test.container.services.sessions.create(workspace.id, { ...CODEX, ...options.config }),
	);
	must(await test.container.sidecar.start());
	// The chat tab records the chat on screen, which the chat shortcuts need.
	test.container.services.sessions.setViewing(session.id);
	const calls = answerSidecar(test, options.answer ?? deliveredAsAsked);
	return { test, sessionId: session.id, calls };
}

function renderBar(test: TestContainer, sessionId: SessionId) {
	return render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<GoalBar sessionId={sessionId} />
				<Toaster />
			</CommandDispatcher>
		</ServicesProvider>,
		{ wrapper: ({ children }: { children: ReactNode }) => <>{children}</> },
	);
}

function reportGoal(test: TestContainer, sessionId: SessionId, goal: CodexGoal | null): void {
	act(() => {
		test.memory.controls.emitSidecarLine(
			JSON.stringify({ jsonrpc: "2.0", method: "goalChanged", params: { sessionId, goal } }),
		);
	});
}

const sentTexts = (calls: SidecarCall[]) =>
	calls.filter((call) => call.method === "sendMessage").map((call) => call.params.text);

afterEach(async () => {
	cleanup();
	toast.dismiss();
	if (opened === null) return;
	await opened.container.stop();
	opened.close();
	opened = null;
});

describe("COMP-10 Codex goal bar", () => {
	it("shows nothing for a Codex chat with no goal", async () => {
		const { test, sessionId } = await setup();
		renderBar(test, sessionId);
		expect(screen.queryByRole("button", { name: "Edit goal" })).toBeNull();
		expect(screen.queryByPlaceholderText("Goal")).toBeNull();
	});

	it("shows a goal the sidecar reports, with Pause goal, Edit goal and Clear goal", async () => {
		const { test, sessionId } = await setup();
		renderBar(test, sessionId);
		reportGoal(test, sessionId, { ...activeGoal, tokenBudget: 50_000, tokensUsed: 12_000 });
		expect(await screen.findByText("Pursuing goal")).toBeTruthy();
		expect(screen.getByText("Ship the importer")).toBeTruthy();
		expect(screen.getByText("12,000 / 50,000")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Pause goal" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Edit goal" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clear goal" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Resume goal" })).toBeNull();
	});

	it("shows 'Enter a goal first.' when Save goal has empty text, and sends nothing", async () => {
		const { test, sessionId, calls } = await setup();
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		fireEvent.click(await screen.findByRole("button", { name: "Edit goal" }));
		fireEvent.change(screen.getByPlaceholderText("Goal"), { target: { value: "   " } });
		fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
		expect(await screen.findByText("Enter a goal first.")).toBeTruthy();
		expect(screen.getByPlaceholderText("Goal")).toBeTruthy();
		expect(sentTexts(calls)).toEqual([]);
	});

	it("opens the field with the goal's text and saves the edit as '/goal <text>'", async () => {
		const { test, sessionId, calls } = await setup();
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		fireEvent.click(await screen.findByRole("button", { name: "Edit goal" }));
		const field = screen.getByPlaceholderText("Goal") as HTMLTextAreaElement;
		expect(field.value).toBe("Ship the importer");
		fireEvent.change(field, { target: { value: "Ship the exporter" } });
		fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
		await waitFor(() => expect(sentTexts(calls)).toEqual(["/goal Ship the exporter"]));
		expect(screen.queryByPlaceholderText("Goal")).toBeNull();
	});

	it("keeps the field open with the typed objective when the save fails", async () => {
		const { test, sessionId, calls } = await setup({
			answer: (call) =>
				call.method === "sendMessage" ? sidecarRefuses("The agent is not running") : {},
		});
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		fireEvent.click(await screen.findByRole("button", { name: "Edit goal" }));
		fireEvent.change(screen.getByPlaceholderText("Goal"), {
			target: { value: "Ship the exporter" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
		expect(await screen.findByText("Failed to update goal.")).toBeTruthy();
		expect(sentTexts(calls)).toEqual(["/goal Ship the exporter"]);
		const field = screen.getByPlaceholderText("Goal") as HTMLTextAreaElement;
		expect(field.value).toBe("Ship the exporter");
	});

	it("pauses, resumes and clears the goal", async () => {
		const { test, sessionId, calls } = await setup();
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		fireEvent.click(await screen.findByRole("button", { name: "Pause goal" }));
		await waitFor(() => expect(sentTexts(calls)).toEqual(["/goal pause"]));
		reportGoal(test, sessionId, pausedGoal);
		expect(await screen.findByText("Paused goal")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
		await waitFor(() => expect(sentTexts(calls)).toEqual(["/goal pause", "/goal resume"]));
		fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
		await waitFor(() =>
			expect(sentTexts(calls)).toEqual(["/goal pause", "/goal resume", "/goal clear"]),
		);
		reportGoal(test, sessionId, null);
		await waitFor(() => expect(screen.queryByText("Paused goal")).toBeNull());
	});

	it("saves with Cmd+Enter through the command dispatcher", async () => {
		const { test, sessionId, calls } = await setup();
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		fireEvent.click(await screen.findByRole("button", { name: "Edit goal" }));
		const field = screen.getByPlaceholderText("Goal");
		field.focus();
		fireEvent.change(field, { target: { value: "Ship from the keyboard" } });
		fireEvent.keyDown(field, { key: "Enter", metaKey: true });
		await waitFor(() => expect(sentTexts(calls)).toEqual(["/goal Ship from the keyboard"]));
	});

	it("reads the goal of a chat with a Codex thread when it is shown", async () => {
		const { test, sessionId } = await setup({
			answer: (call) => (call.method === "getGoal" ? { goal: pausedGoal } : {}),
		});
		must(await test.container.services.sessions.setAgentSessionId(sessionId, "thread-1"));
		renderBar(test, sessionId);
		expect(await screen.findByText("Paused goal")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Resume goal" })).toBeTruthy();
	});

	it("shows nothing for a chat that is not Codex", async () => {
		const { test, sessionId } = await setup({ config: { agent: "claude", model: "default" } });
		renderBar(test, sessionId);
		reportGoal(test, sessionId, activeGoal);
		await waitFor(() =>
			expect(test.container.services.sessions.chatView(sessionId)?.goal).toEqual(activeGoal),
		);
		expect(screen.queryByText("Pursuing goal")).toBeNull();
	});
});
