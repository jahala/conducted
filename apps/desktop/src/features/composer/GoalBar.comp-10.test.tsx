/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: tests of the Codex goal bar over the real container: the Goal field, Save goal, Pause
 * goal, Resume goal, Edit goal and Clear goal, the two messages, a goal the sidecar reports, and
 * Cmd+Enter saving through the mounted command dispatcher.
 * Behaviour: ui-map.md 3.5 and 5.4.
 * Test first: Save with empty text shows "Enter a goal first."
 */
import type { CodexGoal, SessionConfig } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { toast, Toaster } from "../../ui/Toast.tsx";
import { GoalBar } from "./GoalBar.tsx";

const CONFIG: SessionConfig = {
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

interface GoalRequest {
	method: string;
	params: Record<string, unknown>;
}

type Responder = (method: string, params: Record<string, unknown>) => unknown;

/** Answers the goal calls the sidecar cannot answer in this container. */
function answerGoalCalls(test: TestContainer, respond: Responder): GoalRequest[] {
	const transport = test.memory.platform.sidecar;
	const original = transport.send.bind(transport);
	const requests: GoalRequest[] = [];
	transport.send = async (line) => {
		const answered = await original(line);
		const parsed = JSON.parse(line) as {
			id?: number;
			method?: string;
			params?: Record<string, unknown>;
		};
		if (
			parsed.method === "getGoal" ||
			parsed.method === "setGoal" ||
			parsed.method === "changeGoal"
		) {
			const params = parsed.params ?? {};
			requests.push({ method: parsed.method, params });
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({
						jsonrpc: "2.0",
						id: parsed.id,
						result: respond(parsed.method ?? "", params),
					}),
				),
			);
		}
		return answered;
	};
	return requests;
}

async function setup(options: { dispatcher?: boolean } = {}) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const started = await test.container.sidecar.start();
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	test.container.services.sessions.setViewing(session.id);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	const renderBar = () =>
		options.dispatcher === true
			? render(
					<CommandDispatcher>
						<GoalBar sessionId={session.id} editSignal={0} />
						<Toaster />
					</CommandDispatcher>,
					{ wrapper },
				)
			: render(
					<>
						<GoalBar sessionId={session.id} editSignal={0} />
						<Toaster />
					</>,
					{ wrapper },
				);
	return { test, session, renderBar };
}

async function teardown(test: TestContainer): Promise<void> {
	await test.container.stop();
	test.close();
}

afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("COMP-10 Codex goal bar", () => {
	it("shows the Goal field and Save goal for a Codex chat", async () => {
		const { test, renderBar } = await setup();
		try {
			answerGoalCalls(test, () => ({ goal: null }));
			renderBar();
			expect(screen.getByPlaceholderText("Goal")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Save goal" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows 'Enter a goal first.' when Save has empty text", async () => {
		const { test, renderBar } = await setup();
		try {
			const requests = answerGoalCalls(test, () => ({ goal: null }));
			renderBar();
			fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
			expect(await screen.findByText("Enter a goal first.")).toBeTruthy();
			expect(requests.some((request) => request.method === "setGoal")).toBe(false);
		} finally {
			await teardown(test);
		}
	});

	it("saves the goal and shows Pause goal, Edit goal and Clear goal", async () => {
		const { test, renderBar } = await setup();
		try {
			const requests = answerGoalCalls(test, (method) =>
				method === "setGoal" ? { goal: activeGoal } : { goal: null },
			);
			renderBar();
			fireEvent.change(screen.getByPlaceholderText("Goal"), {
				target: { value: "Ship the importer" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
			await waitFor(() =>
				expect(requests.find((request) => request.method === "setGoal")?.params).toEqual({
					sessionId: expect.any(String),
					objective: "Ship the importer",
				}),
			);
			expect(await screen.findByText("Ship the importer")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Pause goal" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Edit goal" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Clear goal" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("pauses, resumes and clears an existing goal", async () => {
		const { test, renderBar } = await setup();
		try {
			answerGoalCalls(test, (method, params) => {
				if (method !== "changeGoal") return { goal: activeGoal };
				const action = params.action;
				if (action === "pause") return { goal: pausedGoal };
				if (action === "resume") return { goal: activeGoal };
				return { goal: null };
			});
			renderBar();
			expect(await screen.findByText("Ship the importer")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
			expect(await screen.findByRole("button", { name: "Resume goal" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
			expect(await screen.findByRole("button", { name: "Pause goal" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
			expect(await screen.findByPlaceholderText("Goal")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("opens the field with the goal's text when Edit goal is clicked", async () => {
		const { test, renderBar } = await setup();
		try {
			answerGoalCalls(test, () => ({ goal: activeGoal }));
			renderBar();
			expect(await screen.findByText("Ship the importer")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
			const field = screen.getByPlaceholderText("Goal") as HTMLInputElement;
			expect(field.value).toBe("Ship the importer");
		} finally {
			await teardown(test);
		}
	});

	it("saves with Cmd+Enter through the command dispatcher", async () => {
		const { test, renderBar } = await setup({ dispatcher: true });
		try {
			const requests = answerGoalCalls(test, (method) =>
				method === "setGoal" ? { goal: activeGoal } : { goal: null },
			);
			renderBar();
			const field = screen.getByPlaceholderText("Goal");
			fireEvent.change(field, { target: { value: "Ship from keyboard" } });
			fireEvent.keyDown(field, { key: "Enter", metaKey: true });
			await waitFor(() =>
				expect(requests.find((request) => request.method === "setGoal")?.params).toEqual({
					sessionId: expect.any(String),
					objective: "Ship from keyboard",
				}),
			);
			expect(await screen.findByText("Ship from keyboard")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows a goal the sidecar reports", async () => {
		const { test, session, renderBar } = await setup();
		try {
			answerGoalCalls(test, () => ({ goal: null }));
			renderBar();
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "goalChanged",
					params: { sessionId: session.id, goal: activeGoal },
				}),
			);
			expect(await screen.findByText("Ship the importer")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Pause goal" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});
});
