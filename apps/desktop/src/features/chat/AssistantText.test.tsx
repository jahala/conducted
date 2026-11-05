import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	markdown: "default",
	strip: false,
	openUrl: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ app: { openUrl: state.openUrl } }),
	useSetting: (key: string) => (key === "not_absolutely_right" ? state.strip : state.markdown),
}));

const { AssistantText } = await import("./AssistantText.tsx");

afterEach(() => {
	cleanup();
	state.markdown = "default";
	state.strip = false;
	state.openUrl.mockReset();
});

describe("CHAT-06 assistant text", () => {
	it("renders an unclosed code fence as a code block without throwing", () => {
		render(<AssistantText text={"Here is the code:\n```ts\nconst answer = 42;"} />);
		expect(screen.getByText("const answer = 42;")).toBeTruthy();
		expect(screen.getByText("ts")).toBeTruthy();
	});

	it("keeps a leading absolutely-right phrase when the setting is off", () => {
		render(<AssistantText text={"You're absolutely right! The fix is small."} />);
		expect(screen.getByText(/You're absolutely right!/)).toBeTruthy();
	});

	it("strips a leading absolutely-right phrase when the setting is on", () => {
		state.strip = true;
		render(<AssistantText text={"You're absolutely right! The fix is small."} />);
		expect(screen.queryByText(/absolutely right/i)).toBeNull();
		expect(screen.getByText("The fix is small.")).toBeTruthy();
	});

	it("renders headings, lists and tables", () => {
		render(
			<AssistantText text={"# Summary\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"} />,
		);
		expect(screen.getByRole("heading", { level: 1, name: "Summary" })).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(screen.getByRole("table")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
	});

	it("renders a callout with its kind", () => {
		render(<AssistantText text={"> [!WARNING]\n> Check the path first."} />);
		expect(screen.getByText("Warning")).toBeTruthy();
		expect(screen.getByText("Check the path first.")).toBeTruthy();
	});

	it("marks the Tufte style", () => {
		state.markdown = "tufte";
		const { container } = render(<AssistantText text={"Some prose."} />);
		expect(container.querySelector('[data-markdown-style="tufte"]')).toBeTruthy();
	});

	it("opens links through the app opener", () => {
		render(<AssistantText text={"[Open the docs](https://example.com/docs)"} />);
		fireEvent.click(screen.getByRole("link", { name: "Open the docs" }));
		expect(state.openUrl).toHaveBeenCalledWith("https://example.com/docs");
	});

	it("renders an image from assistant text", () => {
		render(<AssistantText text={"![A chart](/tmp/chart.png)"} />);
		expect(screen.getByRole("img", { name: "A chart" }).getAttribute("src")).toBe("/tmp/chart.png");
	});

	it("keeps a non-web link from navigating the app window", () => {
		render(<AssistantText text={"[Open the file](file:///tmp/notes.txt)"} />);
		const link = screen.getByRole("link", { name: "Open the file" });
		expect(fireEvent.click(link)).toBe(false);
		expect(state.openUrl).not.toHaveBeenCalled();
	});

	it("keys equal list items and table cells by position", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		render(<AssistantText text={"- yes\n- yes\n\n| A | B |\n| --- | --- |\n| yes | yes |"} />);
		const warnings = errors.mock.calls.map((call) => call.join(" "));
		errors.mockRestore();
		expect(warnings.some((line) => line.includes("same key"))).toBe(false);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(screen.getAllByRole("cell")).toHaveLength(2);
	});
});
