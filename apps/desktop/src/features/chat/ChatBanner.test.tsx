import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const state = vi.hoisted(() => ({ copyText: vi.fn(), openUrl: vi.fn() }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ app: { copyText: state.copyText, openUrl: state.openUrl } }),
}));

const { ChatBanner } = await import("./ChatBanner.tsx");
const { turnErrorView } = await import("./turn-error-view.ts");

afterEach(cleanup);

const notice = (text = ""): Extract<ChatBlock, { kind: "notice" }> => ({
	kind: "notice",
	item: { kind: "notice", notice: "compacted", text },
});
const error = (retryable: boolean): Extract<ChatBlock, { kind: "error" }> => ({
	kind: "error",
	item: { kind: "error", code: "boom", message: "It broke.", retryable },
});

describe("CHAT-06 chat banners", () => {
	it("reads a compacted notice as a quiet line", () => {
		render(<ChatBanner block={notice()} />);
		expect(screen.getByText("Chat history compacted")).toBeTruthy();
	});

	it("offers Retry only for a retryable error, in GFe's words", () => {
		const onRetry = vi.fn();
		render(<ChatBanner block={error(true)} onRetry={onRetry} />);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("hides the retry for an error that cannot be retried", () => {
		render(<ChatBanner block={error(false)} onRetry={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("falls back when an error carries no message", () => {
		render(
			<ChatBanner
				block={{ kind: "error", item: { kind: "error", code: "x", message: "", retryable: false } }}
			/>,
		);
		expect(screen.getByText("This message could not be displayed.")).toBeTruthy();
	});

	it("names a session limit in the banner", () => {
		render(
			<ChatBanner
				block={{
					kind: "notice",
					item: { kind: "notice", notice: "rate_limit", text: "" },
				}}
			/>,
		);
		expect(screen.getByText("Claude Code session limit reached")).toBeTruthy();
	});

	it("shows a compacting notice while history is summarised", () => {
		render(
			<ChatBanner
				block={{
					kind: "notice",
					item: { kind: "notice", notice: "info", text: "Compacting chat history" },
				}}
			/>,
		);
		expect(screen.getByText("Compacting...")).toBeTruthy();
	});

	it("does not read a finished compaction as still running", () => {
		render(
			<ChatBanner
				block={{
					kind: "notice",
					item: { kind: "notice", notice: "info", text: "Compacted 40 messages" },
				}}
			/>,
		);
		expect(screen.getByText("Compacted 40 messages")).toBeTruthy();
		expect(screen.queryByText("Compacting...")).toBeNull();
	});

	it("offers the error and its details from the right-click menu", async () => {
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		render(<ChatBanner block={error(true)} />);
		fireEvent.contextMenu(await screen.findByText("It broke."));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy error" }));
		expect(state.copyText).toHaveBeenCalledWith("It broke.");
		fireEvent.contextMenu(await screen.findByText("It broke."));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy details" }));
		expect(state.copyText).toHaveBeenCalledWith(expect.stringContaining('"code": "boom"'));
	});

	it("offers agent sign-in from an authentication error", async () => {
		renderWithRouter(
			<ChatBanner
				block={{
					kind: "error",
					item: {
						kind: "error",
						code: "agent_auth_required",
						message: "Codex authentication required",
						retryable: false,
					},
				}}
			/>,
		);
		expect(await screen.findByText("Authentication required")).toBeTruthy();
		expect(screen.getByText("Codex authentication required")).toBeTruthy();
		expect(await screen.findByRole("link", { name: "Open settings" })).toBeTruthy();
	});

	it("reads a Codex sign-in error as 'Codex authentication required'", async () => {
		renderWithRouter(
			<ChatBanner
				agent="codex"
				block={{
					kind: "error",
					item: {
						kind: "error",
						code: "agent_auth_required",
						message: "Codex authentication required. Sign in to Codex in the agent settings.",
						retryable: false,
					},
				}}
			/>,
		);
		expect(await screen.findByText("Codex authentication required")).toBeTruthy();
		expect(
			screen.getByText("Please configure Codex authentication in Settings to use Codex."),
		).toBeTruthy();
	});

	it("reads an expired ChatGPT login as 'ChatGPT login expired'", async () => {
		renderWithRouter(
			<ChatBanner
				agent="codex"
				block={{
					kind: "error",
					item: {
						kind: "error",
						code: "agent_auth_required",
						message: "ChatGPT login expired. Sign in to ChatGPT in the agent settings.",
						retryable: false,
					},
				}}
			/>,
		);
		expect(await screen.findByText("ChatGPT login expired")).toBeTruthy();
		expect(
			screen.getByText(
				"Your ChatGPT login has expired. Reconnect ChatGPT, then send your message again.",
			),
		).toBeTruthy();
	});

	it("reads a Cursor sign-in error as 'Cursor API key required'", async () => {
		renderWithRouter(
			<ChatBanner
				agent="cursor"
				block={{
					kind: "error",
					item: {
						kind: "error",
						code: "agent_auth_required",
						message: "Cursor API key is not configured",
						retryable: false,
					},
				}}
			/>,
		);
		expect(await screen.findByText("Cursor API key required")).toBeTruthy();
		expect(
			screen.getByText("Add a Cursor API key in provider settings to use Cursor."),
		).toBeTruthy();
	});
});

// The views of the error that ended a turn, with Conductor's words (IQi @9538488, GFe @9534766).
describe("CHAT-06 a failed turn's error views", () => {
	const turnError = (
		message: string,
		retryable: boolean,
	): Extract<ChatBlock, { kind: "error" }> => ({
		kind: "error",
		item: { kind: "error", code: "turn_error", message, retryable },
	});

	it("offers Retry and Check Anthropic API status for an overloaded server", async () => {
		state.openUrl.mockResolvedValue({ ok: true, value: undefined });
		const message = "API Error: 529 Overloaded";
		const onRetry = vi.fn();
		render(
			<ChatBanner
				block={turnError(message, true)}
				view={turnErrorView(message, "claude")}
				onRetry={onRetry}
			/>,
		);
		expect(
			screen.getByText(
				"Anthropic's API servers are temporarily overloaded. Please try again in a few minutes.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "Check Anthropic API status" }));
		expect(state.openUrl).toHaveBeenCalledWith("https://status.anthropic.com/");
	});

	it("names the context window and offers no Retry", () => {
		const message = "Prompt is too long";
		render(
			<ChatBanner
				block={turnError(message, false)}
				view={turnErrorView(message, "claude")}
				onRetry={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(
				"Exceeded Claude's context window. Please compact using /compact, or summarize into a new chat.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("titles an image over the size limit as Conductor does", () => {
		const message = "image exceeds 5 MB maximum";
		render(
			<ChatBanner block={turnError(message, false)} view={turnErrorView(message, "claude")} />,
		);
		expect(screen.getByText("Image too large")).toBeTruthy();
		expect(
			screen.getByText(
				"Exceeds Claude Code's size limit (5MB). Please revert to a previous user message by hovering over it, otherwise this chat will fail going forward.",
			),
		).toBeTruthy();
	});

	it("asks to try later when the session limit names no reset time", () => {
		const message = "Claude AI usage limit reached|soon";
		render(
			<ChatBanner block={turnError(message, false)} view={turnErrorView(message, "claude")} />,
		);
		expect(screen.getByText("Claude Code session limit reached")).toBeTruthy();
		expect(
			screen.getByText(
				/^Please try again later\. This limit is imposed by Anthropic and applies to all Claude Code usage\./,
			),
		).toBeTruthy();
	});
});
