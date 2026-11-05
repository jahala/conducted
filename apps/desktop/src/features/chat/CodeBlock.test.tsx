import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ copyText: vi.fn(), highlight: vi.fn() }));

vi.mock("shiki", () => ({ codeToTokens: state.highlight }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ app: { copyText: state.copyText } }),
}));

const { CodeBlock } = await import("./CodeBlock.tsx");

beforeEach(() => {
	state.highlight.mockRejectedValue(new Error("Language not found"));
});

afterEach(() => {
	cleanup();
	state.copyText.mockReset();
	state.highlight.mockReset();
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

	it("keeps the colours it has while the code grows, instead of flashing back to plain text", async () => {
		// shiki cannot run under jsdom (its loader needs a browser Response), so its answer is stood in for
		// at the module edge. The second answer is held back to look at the block while it waits.
		const release: Array<() => void> = [];
		state.highlight.mockImplementation(
			(code: string) =>
				new Promise((resolve) => {
					const lines = code.split("\n").map((line) => [{ content: line, color: "#c00" }]);
					const answer = () => resolve({ tokens: lines });
					if (state.highlight.mock.calls.length === 1) answer();
					else release.push(answer);
				}),
		);
		const view = render(<CodeBlock code={"const a = 1;"} language={"ts"} />);
		const coloured = () =>
			[...view.container.querySelectorAll("code span")].filter(
				(node) => (node as HTMLElement).style.color !== "",
			);
		await waitFor(() => expect(coloured()).toHaveLength(1));

		view.rerender(<CodeBlock code={"const a = 1;\nconst b = 2;"} language={"ts"} />);
		await waitFor(() => expect(state.highlight).toHaveBeenCalledTimes(2));

		// The new highlight has not arrived: the first line keeps its colour, the new tail is plain text.
		expect(coloured()).toHaveLength(1);
		expect(view.container.querySelector("code")?.textContent).toBe("const a = 1;\nconst b = 2;");

		release[0]?.();
		await waitFor(() => expect(coloured()).toHaveLength(2));
		expect(view.container.querySelector("code")?.textContent).toBe("const a = 1;\nconst b = 2;");
	});

	it("cuts a very large block and shows all of it on request, copying the whole text", async () => {
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		const code = "x".repeat(5000);
		const view = render(<CodeBlock code={code} language={null} />);
		expect(view.container.querySelector("code")?.textContent).toHaveLength(4000);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith(code));
		fireEvent.click(screen.getByRole("button", { name: "Show all" }));
		expect(view.container.querySelector("code")?.textContent).toHaveLength(5000);
	});
});
