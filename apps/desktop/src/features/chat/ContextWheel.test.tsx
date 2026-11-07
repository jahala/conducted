/**
 * @feature CHAT-14 Context wheel, cost and plan usage
 * Owns: tests of the context wheel and its hover card over the real container: the percentage, when
 * it shows, the notes, the token breakdown, cost, and that the composer toolbar mounts it.
 * Behaviour: ui-map.md 3.3 and 3.5, claude-runner.md 7.
 * Test first: 72,000 of 100,000 tokens shows a 72% ring; 40% with the setting off renders nothing.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, SessionId, TurnId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedContextWindow,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { Composer } from "../composer/Composer.tsx";
import { ContextWheel } from "./ContextWheel.tsx";

type AgentEvent = Extract<SessionEvent, { type: "agent" }>;
type UsageItem = Extract<AgentEvent["message"]["items"][number], { kind: "usage" }>;

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let nextEvent = 0;

function usageEvent(over: Partial<UsageItem> = {}): SessionEvent {
	nextEvent += 1;
	return {
		eventId: `event-${nextEvent}` as EventId,
		at: nextEvent,
		type: "agent",
		turnId: "turn-1" as TurnId,
		message: {
			agent: "claude",
			items: [
				{
					kind: "usage",
					inputTokens: 1200,
					outputTokens: 300,
					cacheReadTokens: 4000,
					cacheWriteTokens: 500,
					costUsd: 0.0123,
					contextUsedTokens: 72_000,
					contextWindowTokens: 100_000,
					model: "claude-sonnet-4-5",
					fastMode: false,
					serviceTier: "standard",
					...over,
				},
			],
		},
	};
}

function addUsage(
	test: TestContainer,
	sessionId: SessionId,
	over: Partial<UsageItem> = {},
	idx = 1,
): void {
	const event = usageEvent(over);
	test.container.services.sessions.applyStoredEvent(sessionId, idx, event, 1000 + idx);
	// The ingest stores a reported window in the per-model table, the chat's one home for it.
	const item = (event as AgentEvent).message.items.find((entry) => entry.kind === "usage");
	if (item?.kind === "usage" && item.contextWindowTokens !== undefined) {
		test.container.services.contextWindows.remember(
			"claude",
			CONFIG.model,
			item.contextWindowTokens,
		);
	}
}

function setSetting(test: TestContainer, key: string, value: boolean): void {
	test.container.services.settings.store.setState((state) => ({
		...state,
		values: { ...state.values, [key]: value },
	}));
}

async function setup(over: Partial<SessionConfig> = {}) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, {
		...CONFIG,
		...over,
	});
	if (!created.ok) throw new Error("Could not create the chat.");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { test, session: created.value, workspace, wrapper };
}

async function teardown(test: TestContainer): Promise<void> {
	cleanup();
	await test.container.stop();
	test.close();
}

afterEach(cleanup);

describe("CHAT-14 context wheel", () => {
	it("shows a 72% ring when 72,000 of 100,000 tokens are used", async () => {
		const { test, session, wrapper } = await setup();
		try {
			addUsage(test, session.id);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("renders nothing at 40% when Always show context usage is off", async () => {
		const { test, session, wrapper } = await setup();
		try {
			addUsage(test, session.id, { contextUsedTokens: 40_000 });
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: /Context usage/ })).toBeNull();
		} finally {
			await teardown(test);
		}
	});

	it("shows usage below 70% when Always show context usage is on", async () => {
		const { test, session, wrapper } = await setup();
		try {
			setSetting(test, "always_show_context_wheel", true);
			addUsage(test, session.id, { contextUsedTokens: 40_000 });
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows the window, token breakdown, model, effort and service tier in the hover card", async () => {
		const { test, session, wrapper } = await setup();
		try {
			addUsage(test, session.id);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			fireEvent.focus(screen.getByRole("button", { name: "Context usage" }));
			expect(await screen.findByText("Window used: 72,000 of 100,000 tokens")).toBeTruthy();
			expect(screen.getByText("Input")).toBeTruthy();
			expect(screen.getByText("1,200")).toBeTruthy();
			expect(screen.getByText("Cached input")).toBeTruthy();
			expect(screen.getByText("4,000")).toBeTruthy();
			expect(screen.getByText("Cache write")).toBeTruthy();
			expect(screen.getByText("500")).toBeTruthy();
			expect(screen.getByText("Output")).toBeTruthy();
			expect(screen.getByText("300")).toBeTruthy();
			expect(screen.getByText("claude-sonnet-4-5")).toBeTruthy();
			expect(screen.getByText("high")).toBeTruthy();
			expect(screen.getByText("standard")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("clamps usage above the window at 100%", async () => {
		const { test, session, wrapper } = await setup();
		try {
			addUsage(test, session.id, { contextUsedTokens: 140_000 });
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("says the context window size is not available yet when the chat has none", async () => {
		const { test, session, wrapper } = await setup();
		try {
			setSetting(test, "always_show_context_wheel", true);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			fireEvent.focus(screen.getByRole("button", { name: "Context usage" }));
			expect(await screen.findByText("Context window size not yet available.")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("uses the window the same model reported in another chat when this one has none", async () => {
		const { test, session, wrapper } = await setup();
		try {
			// An earlier chat of this agent and model reported its window, which the app remembers.
			test.container.services.contextWindows.remember("claude", CONFIG.model, 100_000);
			addUsage(test, session.id, { contextWindowTokens: undefined });
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("reads the window from the model table, not from the usage item", async () => {
		const { test, session, wrapper } = await setup();
		try {
			// The usage item reports 200,000, but the app remembers the model's window as 100,000.
			addUsage(test, session.id, { contextWindowTokens: 200_000 });
			test.container.services.contextWindows.remember("claude", CONFIG.model, 100_000);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("loads the remembered windows from the database when the app starts", async () => {
		const { test, session, wrapper } = await setup();
		try {
			await seedContextWindow(test.container, "claude", CONFIG.model, 100_000);
			expect((await test.container.services.contextWindows.start()).ok).toBe(true);
			addUsage(test, session.id, { contextWindowTokens: undefined });
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("says context usage is unavailable for Cursor", async () => {
		const { test, session, wrapper } = await setup({ agent: "cursor" });
		try {
			setSetting(test, "always_show_context_wheel", true);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			fireEvent.focus(screen.getByRole("button", { name: "Context usage" }));
			expect(await screen.findByText("Context usage is unavailable for Cursor.")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows the turn's cost only when Show agent cost is on", async () => {
		const { test, session, wrapper } = await setup();
		try {
			addUsage(test, session.id);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			fireEvent.focus(screen.getByRole("button", { name: "Context usage" }));
			await screen.findByText("Window used: 72,000 of 100,000 tokens");
			expect(screen.queryByText("Cost")).toBeNull();

			setSetting(test, "experimental_show_agent_cost", true);
			expect(await screen.findByText("Cost")).toBeTruthy();
			expect(screen.getByText("$0.0123")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows usage that arrives after the chat is open", async () => {
		const { test, session, wrapper } = await setup();
		try {
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: /Context usage/ })).toBeNull();
			act(() => addUsage(test, session.id, { contextUsedTokens: 80_000 }));
			expect(await screen.findByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("is mounted in the composer toolbar", async () => {
		const { test, session, workspace, wrapper } = await setup();
		try {
			addUsage(test, session.id);
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			expect(await screen.findByRole("button", { name: "Context usage" })).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});
});
