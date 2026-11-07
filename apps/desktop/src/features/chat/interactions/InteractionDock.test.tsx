/**
 * Tests for CHAT-10: the dock shows the chat's one open interaction above the composer.
 */
import type { Interaction } from "@conducted/protocol";
import { type InteractionId, ok, type SessionId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	chat: { state: "loading" as "loading" | "ready" | "error" },
	answer: vi.fn(),
	cancel: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useChat: () => state.chat,
	useActions: () => ({
		sessions: { answer: state.answer, cancel: state.cancel },
	}),
	// The question card looks its keys up in the command registry with the user's rebinds.
	useShortcutOverrides: () => ({ overrides: {}, error: null }),
	useSetting: () => "enter",
	useLiveShortcut: () => null,
}));

const { InteractionDock } = await import("./InteractionDock.tsx");

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

const question: Interaction = {
	kind: "question",
	questions: [
		{
			question: "Which database?",
			options: [{ label: "SQLite" }, { label: "Postgres" }],
			multiSelect: false,
		},
	],
};

beforeEach(() => {
	state.chat = { state: "loading" };
	state.answer.mockReset().mockResolvedValue(ok(undefined));
	state.cancel.mockReset().mockResolvedValue(ok(undefined));
});

afterEach(cleanup);

describe("CHAT-10 interaction dock", () => {
	it("renders the question card when the chat has an open question", () => {
		state.chat = {
			state: "ready",
			data: { openInteraction: { interactionId, interaction: question } },
		} as never;

		render(<InteractionDock sessionId={sessionId} />);

		expect(screen.getByText("Which database?")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
	});

	it("renders nothing when no interaction is open", () => {
		state.chat = { state: "ready", data: { openInteraction: null } } as never;

		const { container } = render(<InteractionDock sessionId={sessionId} />);

		expect(container.innerHTML).toBe("");
	});

	it("renders nothing while the chat is loading", () => {
		state.chat = { state: "loading" };

		const { container } = render(<InteractionDock sessionId={sessionId} />);

		expect(container.innerHTML).toBe("");
	});
});
