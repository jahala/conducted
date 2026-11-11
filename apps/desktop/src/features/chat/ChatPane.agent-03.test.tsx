/**
 * @feature AGENT-03 Claude: an assistant message with an error, as the chat shows it
 * Behaviour: Conductor renders the assistant message's text whatever its `error` (renderApp kpa
 * @9558460), draws the failed result as "Claude Code error: <text>" with Retry (Rpa @9564247, GFe
 * @9534766) or as sign-in (SQi), and draws the error that ended a turn through IQi @9538488.
 * Test first: an API error turn shows the assistant's text and one "Claude Code error" banner
 * with Retry.
 */
import type { AgentItem, SessionConfig, SessionEvent } from "@conducted/protocol";
import type { SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { ChatPane } from "./ChatPane.tsx";

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

afterEach(cleanup);

/**
 * One finished turn, stored the way the ingest path stores it: the user's message, then each
 * agent message the Claude translator gave, then the end of the turn.
 */
function feedTurn(
	test: ReturnType<typeof createTestContainer>,
	sessionId: SessionId,
	agentMessages: AgentItem[][],
	end: { outcome: "success" | "error"; error?: string },
): void {
	const base = { at: 1_700_000_000_000, turnId: "turn-1" as TurnId };
	const events = [
		{
			...base,
			eventId: "e-user",
			type: "user_message",
			messageId: "m1",
			text: "Add the helper",
			attachmentPaths: [],
			delivery: "new_turn",
			config: CONFIG,
		},
		...agentMessages.map((items, index) => ({
			...base,
			eventId: `e-agent-${index}`,
			type: "agent",
			message: { agent: "claude", items },
		})),
		{ ...base, eventId: "e-end", type: "turn_ended", ...end },
	] as SessionEvent[];
	for (const [idx, event] of events.entries()) {
		test.container.services.sessions.applyStoredEvent(sessionId, idx, event, event.at);
	}
}

async function mount(
	test: ReturnType<typeof createTestContainer>,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <ChatPane workspaceId={workspaceId} sessionId={sessionId} />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
				<RouterProvider router={router} />
			</VirtuosoMockContext.Provider>
		</ServicesProvider>,
	);
	await router.load();
}

async function showTurn(agentMessages: AgentItem[][], end: { outcome: "error"; error?: string }) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	must(await test.container.services.sessions.start());
	feedTurn(test, chat.id, agentMessages, end);
	await mount(test, workspace.id, chat.id);
	await screen.findByText("Add the helper");
	return async () => {
		cleanup();
		await test.container.stop();
		test.close();
	};
}

describe("AGENT-03 an assistant message with an error in the chat", () => {
	it("shows the assistant's text and one Claude Code error banner with Retry (kpa, Rpa, GFe)", async () => {
		const said = "API Error: 500 Internal server error";
		const shown = `Claude Code error: ${said}`;
		const stop = await showTurn(
			[
				[{ kind: "text", text: said }],
				[{ kind: "error", code: "agent_error", message: shown, retryable: true }],
			],
			{ outcome: "error", error: shown },
		);
		try {
			const alerts = await screen.findAllByRole("alert");
			expect(screen.getByText(said)).toBeTruthy();
			expect(alerts).toHaveLength(1);
			const alert = within(alerts[0] as HTMLElement);
			expect(alert.getByText(shown)).toBeTruthy();
			expect(alert.getByRole("button", { name: "Retry" })).toBeTruthy();
		} finally {
			await stop();
		}
	});

	it("shows a sign-in error once, as the sign-in view, and hides the text that repeats it (SQi, kpa)", async () => {
		const said = "Invalid API key · Please run /login";
		const stop = await showTurn(
			[
				[{ kind: "text", text: said }],
				[{ kind: "error", code: "agent_auth_required", message: said, retryable: false }],
			],
			{ outcome: "error", error: said },
		);
		try {
			const alerts = await screen.findAllByRole("alert");
			expect(alerts).toHaveLength(1);
			const alert = within(alerts[0] as HTMLElement);
			expect(alert.getByText("Authentication required")).toBeTruthy();
			expect(alert.getByText(said)).toBeTruthy();
			expect(alert.getByRole("link", { name: "Open agent settings" })).toBeTruthy();
			expect(screen.getAllByText(said)).toHaveLength(1);
		} finally {
			await stop();
		}
	});

	it("shows Conductor's session limit view for a turn that ended on the usage limit (IQi)", async () => {
		const stop = await showTurn([], {
			outcome: "error",
			error: "Claude AI usage limit reached|1767225600",
		});
		try {
			const alert = within(await screen.findByRole("alert"));
			expect(alert.getByText("Claude Code session limit reached")).toBeTruthy();
			expect(
				alert.getByText(
					/This limit is imposed by Anthropic and applies to all Claude Code usage\./,
				),
			).toBeTruthy();
			expect(alert.getByText(/Your limit will be reset on/)).toBeTruthy();
			expect(alert.getByRole("link", { name: "Learn more about Claude Code limits" })).toBeTruthy();
			expect(alert.queryByRole("button", { name: "Retry" })).toBeNull();
		} finally {
			await stop();
		}
	});

	it("shows any other turn error as 'Error: <text>' with Retry (IQi, GFe)", async () => {
		const stop = await showTurn([], {
			outcome: "error",
			error: "Claude Code process exited with code 1",
		});
		try {
			const alert = within(await screen.findByRole("alert"));
			expect(alert.getByText("Error: Claude Code process exited with code 1")).toBeTruthy();
			expect(alert.getByRole("button", { name: "Retry" })).toBeTruthy();
		} finally {
			await stop();
		}
	});
});
