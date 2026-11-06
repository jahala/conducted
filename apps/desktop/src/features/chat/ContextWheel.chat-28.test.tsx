/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: tests that the context wheel's hover card asks the sidecar for the usage answer when it
 * opens and passes the account and rate limits to UsageAccountRows, with only the newest answer
 * shown.
 * Behaviour: claude-runner.md 7 (usage is read on demand; failures leave the rows out);
 * Conductor's card (renderApp `FXo`: asked only while the card is open; `zXo` and `RXo`: Claude
 * and Codex have the usage section, Cursor and ACP agents do not).
 * Test first: the hover card shows the signed-in account and limit rows from a getContextUsage answer.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import { appError, err, ok, type Result, type SessionId, type TurnId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { ContextWheel } from "./ContextWheel.tsx";

type GetUsage = Awaited<ReturnType<TestContainer["container"]["sidecar"]["request"]>>;
type UsageAnswer = Extract<GetUsage, { ok: true }>["value"];

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

function usageEvent(contextUsedTokens: number): SessionEvent {
	nextEvent += 1;
	return {
		eventId: `event-${nextEvent}`,
		at: nextEvent,
		type: "agent",
		turnId: "turn-1" as TurnId,
		message: {
			agent: "claude",
			items: [
				{
					kind: "usage",
					inputTokens: 100,
					outputTokens: 20,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					contextUsedTokens,
					contextWindowTokens: 100_000,
				},
			],
		},
	} as SessionEvent;
}

function addUsage(
	test: TestContainer,
	sessionId: SessionId,
	contextUsedTokens: number,
	idx: number,
) {
	test.container.services.sessions.applyStoredEvent(
		sessionId,
		idx,
		usageEvent(contextUsedTokens),
		1000 + idx,
	);
}

function setAlwaysShow(test: TestContainer): void {
	test.container.services.settings.store.setState((state) => ({
		...state,
		values: { ...state.values, always_show_context_wheel: true },
	}));
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function answer(
	account: { loginMethod?: string; plan?: string },
	usedPercent: number,
): UsageAnswer {
	return {
		usedTokens: 40_000,
		windowTokens: 100_000,
		rateLimits: [{ label: "5-hour limit", usedPercent, windowMinutes: 300 }],
		account,
	};
}

async function setup(config: SessionConfig = CONFIG) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config);
	if (!created.ok) throw new Error("Could not create the chat.");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	setAlwaysShow(test);
	return { test, session: created.value, wrapper };
}

async function teardown(test: TestContainer): Promise<void> {
	cleanup();
	await test.container.stop();
	test.close();
}

afterEach(cleanup);

const openCard = () => fireEvent.focus(screen.getByRole("button", { name: /^Context usage/ }));
const closeCard = () => fireEvent.blur(screen.getByRole("button", { name: /^Context usage/ }));

describe("CHAT-28 usage popover rows", () => {
	it("shows the account and limit rows from the sidecar's usage answer", async () => {
		const { test, session, wrapper } = await setup();
		try {
			// seam: CHAT-28 the sidecar is another process; the test gives its answer.
			const request = vi
				.spyOn(test.container.sidecar, "request")
				.mockResolvedValue(ok(answer({ loginMethod: "Claude account", plan: "Max" }, 42)));

			addUsage(test, session.id, 40_000, 1);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			expect(request).not.toHaveBeenCalled();
			openCard();

			expect(await screen.findByText("Login method")).toBeTruthy();
			expect(request).toHaveBeenCalledWith("getContextUsage", { sessionId: session.id });
			expect(screen.getByText("Claude account")).toBeTruthy();
			expect(screen.getByText("Max")).toBeTruthy();
			expect(screen.getByText("Claude usage")).toBeTruthy();
			expect(screen.getByText("5h limit")).toBeTruthy();
			expect(screen.getByText("58% left")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("shows only the newest usage answer when two calls overlap", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const older = deferred<Result<UsageAnswer>>();
			const newer = deferred<Result<UsageAnswer>>();
			let calls = 0;
			// seam: CHAT-28 the sidecar is another process; the test orders its answers.
			vi.spyOn(test.container.sidecar, "request").mockImplementation(() => {
				calls += 1;
				return calls === 1 ? older.promise : newer.promise;
			});

			addUsage(test, session.id, 10_000, 1);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			openCard();
			await vi.waitFor(() => expect(calls).toBe(1));
			closeCard();
			await vi.waitFor(() => expect(screen.queryByText("Claude usage")).toBeNull());
			openCard();
			await vi.waitFor(() => expect(calls).toBe(2));

			act(() => newer.resolve(ok(answer({ loginMethod: "Newer account" }, 20))));
			expect(await screen.findByText("Newer account")).toBeTruthy();

			act(() => older.resolve(ok(answer({ loginMethod: "Older account" }, 80))));
			await vi.waitFor(() => expect(screen.queryByText("Older account")).toBeNull());
			expect(screen.getByText("Newer account")).toBeTruthy();
		} finally {
			await teardown(test);
		}
	});

	it("says the provider gave no usage data when the sidecar cannot answer", async () => {
		const { test, session, wrapper } = await setup();
		try {
			// seam: CHAT-28 the sidecar is another process; the test makes it refuse.
			vi.spyOn(test.container.sidecar, "request").mockResolvedValue(
				err(
					appError("context_usage_unavailable", "This chat has not reported its context window."),
				),
			);

			addUsage(test, session.id, 40_000, 1);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			openCard();

			expect(
				await screen.findByText(
					"Usage data unavailable from provider. It refreshes after Claude responds.",
				),
			).toBeTruthy();
			expect(screen.queryByText("Login method")).toBeNull();
		} finally {
			await teardown(test);
		}
	});

	it("asks nothing and shows no usage section for a Cursor chat", async () => {
		const { test, session, wrapper } = await setup({ ...CONFIG, agent: "cursor" });
		try {
			// seam: CHAT-28 the sidecar is another process; the test watches for a request.
			const request = vi
				.spyOn(test.container.sidecar, "request")
				.mockResolvedValue(ok(answer({ loginMethod: "Claude account" }, 42)));

			addUsage(test, session.id, 40_000, 1);
			render(<ContextWheel sessionId={session.id} />, { wrapper });
			openCard();

			expect(await screen.findByText("Context")).toBeTruthy();
			expect(request).not.toHaveBeenCalled();
			expect(screen.queryByText("Claude usage")).toBeNull();
		} finally {
			await teardown(test);
		}
	});
});
