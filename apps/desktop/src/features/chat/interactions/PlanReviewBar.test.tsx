/**
 * Tests for CHAT-12: the plan review bar approves, rejects with feedback, copies, hands off and
 * answers its shortcut.
 */
import type { Interaction, SessionConfig } from "@conducted/protocol";
import { type InteractionId, ok, type SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { CommandDispatcher } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { Session } from "../../../core/model.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../../test/container.ts";
import { InteractionDock } from "./InteractionDock.tsx";
import { PlanReviewBar } from "./PlanReviewBar.tsx";

const interactionId = "i1" as InteractionId;
const plan = "First, change the parser.\nThen run the tests.";

type PlanApproval = Extract<Interaction, { kind: "plan_approval" }>;

const request = (changes: Partial<PlanApproval> = {}): PlanApproval => ({
	kind: "plan_approval",
	plan,
	...changes,
});

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: true,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

interface Setup {
	test: TestContainer;
	session: Session;
}

let open: TestContainer | null = null;

async function setup(): Promise<Setup> {
	const test = createTestContainer();
	open = test;
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config());
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	await test.container.services.sessions.start();
	await test.container.services.sessions.open(created.value.id);
	test.container.services.sessions.store.setState({ viewingSessionId: created.value.id });
	return { test, session: created.value };
}

function renderBar(test: TestContainer, sessionId: SessionId, changes: Partial<PlanApproval> = {}) {
	const content = (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<PlanReviewBar
					sessionId={sessionId}
					interactionId={interactionId}
					request={request(changes)}
				/>
			</CommandDispatcher>
		</ServicesProvider>
	);
	return render(content);
}

async function renderBarInRouter(
	test: TestContainer,
	sessionId: SessionId,
	changes: Partial<PlanApproval> = {},
) {
	const content = (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<PlanReviewBar
					sessionId={sessionId}
					interactionId={interactionId}
					request={request(changes)}
				/>
			</CommandDispatcher>
		</ServicesProvider>
	);
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => content,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
	await router.load();
}

const group = () => screen.getByRole("group", { name: "Plan review" });

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (open !== null) {
		open.close();
		open = null;
	}
});

describe("CHAT-12 plan review bar", () => {
	it("approves the plan and turns plan mode off", async () => {
		const { test, session } = await setup();
		const answer = vi
			.spyOn(test.container.services.sessions, "answer")
			.mockResolvedValue(ok(undefined));
		const updateConfig = vi
			.spyOn(test.container.services.sessions, "updateConfig")
			.mockResolvedValue(ok(undefined));

		renderBar(test, session.id);
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(session.id, interactionId, {
				kind: "plan_approval",
				approved: true,
			}),
		);
		await waitFor(() =>
			expect(updateConfig).toHaveBeenCalledWith(session.id, {
				...config(),
				planMode: false,
			}),
		);
		expect(await screen.findByText("Approved")).toBeTruthy();
	});

	it("rejects the plan with the typed feedback", async () => {
		const { test, session } = await setup();
		const answer = vi
			.spyOn(test.container.services.sessions, "answer")
			.mockResolvedValue(ok(undefined));

		renderBar(test, session.id);
		fireEvent.change(screen.getByLabelText("Plan feedback"), {
			target: { value: "Use the existing tokenizer instead." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reject plan" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(session.id, interactionId, {
				kind: "plan_approval",
				approved: false,
				feedback: "Use the existing tokenizer instead.",
			}),
		);
	});

	it("keeps Reject disabled until the feedback box has text", async () => {
		const { test, session } = await setup();

		renderBar(test, session.id);

		expect(screen.getByRole("button", { name: "Reject plan" }).hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText("Plan feedback"), { target: { value: "Change it." } });
		expect(screen.getByRole("button", { name: "Reject plan" }).hasAttribute("disabled")).toBe(
			false,
		);
	});

	it("copies the plan text", async () => {
		const { test, session } = await setup();

		renderBar(test, session.id);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));

		await waitFor(() => expect(test.memory.controls.clipboardText).toBe(plan));
	});

	it("hands the plan to a new chat by default", async () => {
		const { test, session } = await setup();
		const startFromPlan = vi
			.spyOn(test.container.services.sessions, "startFromPlan")
			.mockResolvedValue(ok(session));

		renderBar(test, session.id);
		fireEvent.click(screen.getByRole("button", { name: "Hand off" }));

		await waitFor(() => expect(startFromPlan).toHaveBeenCalledWith(session.id, plan, null));
		expect(await screen.findByText("Sent to a new chat")).toBeTruthy();
	});

	it("hands the plan to the chat chosen in the picker", async () => {
		const { test, session } = await setup();
		const second = await test.container.services.sessions.create(
			session.workspaceId,
			config({ planMode: false }),
		);
		if (!second.ok) throw new Error(JSON.stringify(second.error));
		await test.container.services.sessions.rename(second.value.id, "Second chat");
		const startFromPlan = vi
			.spyOn(test.container.services.sessions, "startFromPlan")
			.mockResolvedValue(ok(second.value));

		renderBar(test, session.id);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Sending to" }), { key: "Enter" });
		fireEvent.keyDown(await screen.findByRole("option", { name: "Second chat" }), {
			key: "Enter",
		});
		fireEvent.click(screen.getByRole("button", { name: "Hand off" }));

		await waitFor(() =>
			expect(startFromPlan).toHaveBeenCalledWith(session.id, plan, second.value.id),
		);
	});

	it("approves when Cmd+Shift+Enter is pressed into the root dispatcher", async () => {
		const { test, session } = await setup();
		const answer = vi
			.spyOn(test.container.services.sessions, "answer")
			.mockResolvedValue(ok(undefined));
		vi.spyOn(test.container.services.sessions, "updateConfig").mockResolvedValue(ok(undefined));

		renderBar(test, session.id);
		fireEvent.keyDown(group(), { key: "Enter", metaKey: true, shiftKey: true });

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(session.id, interactionId, {
				kind: "plan_approval",
				approved: true,
			}),
		);
	});

	it("submits typed feedback when Cmd+Shift+Enter is pressed into the root dispatcher", async () => {
		const { test, session } = await setup();
		const answer = vi
			.spyOn(test.container.services.sessions, "answer")
			.mockResolvedValue(ok(undefined));

		renderBar(test, session.id);
		const feedback = screen.getByLabelText("Plan feedback");
		fireEvent.change(feedback, { target: { value: "Keep the old schema." } });
		fireEvent.keyDown(feedback, { key: "Enter", metaKey: true, shiftKey: true });

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(session.id, interactionId, {
				kind: "plan_approval",
				approved: false,
				feedback: "Keep the old schema.",
			}),
		);
	});

	it("shows the first lines of a long plan with a Show all control", async () => {
		const { test, session } = await setup();
		const longPlan = Array.from({ length: 30 }, (_, index) => `Step ${index + 1}`).join("\n");

		renderBar(test, session.id, { plan: longPlan });

		expect(screen.getByText(/Step 1/)).toBeTruthy();
		expect(screen.queryByText(/Step 30/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Show all 30 lines/ }));
		expect(screen.getByText(/Step 30/)).toBeTruthy();
	});

	it("links the plan file", async () => {
		const { test, session } = await setup();

		await renderBarInRouter(test, session.id, { planFilePath: "docs/plans/change.md" });

		expect(screen.getByRole("button", { name: "Open plan file" })).toBeTruthy();
	});

	it("comes from the live interaction dock over the real container", async () => {
		const { test, session } = await setup();
		void test.container.services.sessions.requestInteraction({
			sessionId: session.id,
			interactionId,
			interaction: request(),
		});

		render(
			<ServicesProvider container={test.container}>
				<CommandDispatcher>
					<InteractionDock sessionId={session.id} />
				</CommandDispatcher>
			</ServicesProvider>,
		);

		expect(screen.getByText("Review plan")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
	});
});
