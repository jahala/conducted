import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer } from "../../test/container.ts";
import { MermaidDiagram } from "./MermaidDiagram.tsx";

// seam: CHAT-24 mermaid needs real browser layout; its renderer is stood in for at the module edge.
const state = vi.hoisted(() => ({
	render: vi.fn(),
	initialize: vi.fn(),
}));

vi.mock("mermaid", () => ({
	default: { render: state.render, initialize: state.initialize },
}));

const svgWith = (label: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`;

let test: ReturnType<typeof createTestContainer>;

beforeEach(() => {
	test = createTestContainer();
	state.render.mockReset();
	state.initialize.mockReset();
});

afterEach(() => {
	cleanup();
	delete document.documentElement.dataset.theme;
	test.close();
});

function mount(ui: ReactNode) {
	return render(<ServicesProvider container={test.container}>{ui}</ServicesProvider>);
}

describe("CHAT-24 mermaid diagram", () => {
	it("shows the source in a code block with a plain message when it does not parse", async () => {
		state.render.mockRejectedValue(new Error("Parse error on line 1"));
		mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);

		expect(
			await screen.findByText("This diagram could not be drawn. The source is shown below."),
		).toBeTruthy();
		expect(screen.getByText(/graph TD/)).toBeTruthy();
	});

	it("logs why a diagram could not be drawn", async () => {
		state.render.mockRejectedValue(new Error("Parse error on line 1"));
		mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);

		await screen.findByText("This diagram could not be drawn. The source is shown below.");
		expect(test.memory.controls.logs).toContainEqual({
			level: "warn",
			message: "The Mermaid diagram could not be drawn: Parse error on line 1",
		});
	});

	it("says Rendering diagram... while it works and then offers Expand diagram", async () => {
		let release: ((value: { svg: string }) => void) | undefined;
		state.render.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);

		expect(screen.getByText("Rendering diagram...")).toBeTruthy();
		await waitFor(() => expect(state.render).toHaveBeenCalledTimes(1));
		expect(screen.getByText("Rendering diagram...")).toBeTruthy();

		release?.({ svg: svgWith("flow") });
		expect(await screen.findByRole("button", { name: "Expand diagram" })).toBeTruthy();
		expect(screen.getByText("flow")).toBeTruthy();
	});

	it("copies the exact Mermaid source and draws in the expanded view with zoom controls", async () => {
		state.render.mockResolvedValue({ svg: svgWith("flow") });
		const source = "graph TD\nA --> B";
		mount(<MermaidDiagram source={source} streaming={false} />);

		fireEvent.click(await screen.findByRole("button", { name: "Copy Mermaid source" }));
		await waitFor(() => expect(test.memory.controls.clipboardText).toBe(source));

		fireEvent.click(screen.getByRole("button", { name: "Expand diagram" }));
		fireEvent.click(await screen.findByRole("button", { name: "Zoom in" }));
		const expanded = screen.getByTestId("mermaid-expanded");
		expect(expanded.getAttribute("data-zoom")).toBe("1.25");
		fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
		expect(expanded.getAttribute("data-zoom")).toBe("1");
		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		fireEvent.click(screen.getByRole("button", { name: "Reset" }));
		expect(expanded.getAttribute("data-zoom")).toBe("1");
	});

	it("zooms the expanded diagram from its top left corner, so scrolling reaches every edge", async () => {
		state.render.mockResolvedValue({ svg: svgWith("flow") });
		mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);

		fireEvent.click(await screen.findByRole("button", { name: "Expand diagram" }));
		fireEvent.click(await screen.findByRole("button", { name: "Zoom in" }));
		const expanded = screen.getByTestId("mermaid-expanded");
		expect(expanded.style.transform).toBe("scale(1.25)");
		// The style says "top left"; CSS serialises the keywords horizontal first.
		expect(expanded.style.transformOrigin).toBe("left top");
	});

	it("gives two diagrams in one reply different element ids", async () => {
		state.render.mockResolvedValue({ svg: svgWith("flow") });
		mount(
			<>
				<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />
				<MermaidDiagram source={"graph TD\nC --> D"} streaming={false} />
			</>,
		);

		await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
		const ids = state.render.mock.calls.map((call) => String(call[0]));
		expect(new Set(ids).size).toBe(2);
	});

	it("keeps the last diagram while the source still streams and draws the final source", async () => {
		state.render.mockImplementation(async (_id: string, source: string) => ({
			svg: svgWith(source),
		}));
		const view = mount(<MermaidDiagram source={"first"} streaming={false} />);
		expect(await view.findByText("first")).toBeTruthy();

		view.rerender(
			<ServicesProvider container={test.container}>
				<MermaidDiagram source={"half"} streaming={true} />
			</ServicesProvider>,
		);
		expect(view.getByText("first")).toBeTruthy();

		view.rerender(
			<ServicesProvider container={test.container}>
				<MermaidDiagram source={"second"} streaming={false} />
			</ServicesProvider>,
		);
		expect(await view.findByText("second")).toBeTruthy();
		const drawn = state.render.mock.calls.map((call) => String(call[1]));
		expect(drawn).toEqual(["first", "second"]);
	});

	it("draws again in the new theme when the app theme changes", async () => {
		state.render.mockResolvedValue({ svg: svgWith("flow") });
		mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);
		await screen.findByRole("button", { name: "Expand diagram" });

		act(() => {
			document.documentElement.dataset.theme = "dark";
		});

		await waitFor(() => expect(state.render).toHaveBeenCalledTimes(2));
		expect(state.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
	});

	it("removes scripts and event handlers before the svg is inserted", async () => {
		state.render.mockResolvedValue({
			svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"><script>steal()</script><text>safe</text></svg>',
		});
		const view = mount(<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />);
		await screen.findByRole("button", { name: "Expand diagram" });

		expect(view.container.querySelector("script")).toBeNull();
		expect(view.container.querySelector("[onload]")).toBeNull();
		expect(view.getByText("safe")).toBeTruthy();
	});
});
