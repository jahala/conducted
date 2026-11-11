import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const state = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ app: { copyText: state.copyText } }),
}));

const { ChatBanner } = await import("./ChatBanner.tsx");

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

	it("offers Try again only for a retryable error", () => {
		const onRetry = vi.fn();
		render(<ChatBanner block={error(true)} onRetry={onRetry} />);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("hides the retry for an error that cannot be retried", () => {
		render(<ChatBanner block={error(false)} onRetry={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	});

	it("falls back when an error carries no message", () => {
		render(
			<ChatBanner
				block={{ kind: "error", item: { kind: "error", code: "x", message: "", retryable: false } }}
			/>,
		);
		expect(screen.getByText("This content could not be displayed.")).toBeTruthy();
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
		expect(await screen.findByRole("link", { name: "Open agent settings" })).toBeTruthy();
	});
});
