import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ app: { copyText: state.copyText } }),
}));

const { CodeBlock } = await import("./CodeBlock.tsx");

afterEach(() => {
	cleanup();
	state.copyText.mockReset();
});

describe("CHAT-06 code block", () => {
	it("shows the code for an unknown language and copies exactly that text", async () => {
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		render(<CodeBlock code={"const a = 1;\n"} language={"not-a-language"} />);
		expect(screen.getByText(/const a = 1;/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith("const a = 1;\n"));
	});

	it("shows plain text when there is no language", () => {
		render(<CodeBlock code={"plain words"} language={null} />);
		expect(screen.getByText("plain words")).toBeTruthy();
	});
});
