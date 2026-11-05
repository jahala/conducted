import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { PanelLayoutProvider, ResizableGroup, ResizablePanel, ResizeHandle } from "./resizable.tsx";

afterEach(cleanup);

describe("NAV-01 resizable panels", () => {
	it("renders one separator between two panels", () => {
		render(
			<ResizableGroup id="nav-01-resizable" orientation="horizontal">
				<ResizablePanel id="left" defaultSize="40%">
					left panel
				</ResizablePanel>
				<ResizeHandle />
				<ResizablePanel id="right" defaultSize="60%">
					right panel
				</ResizablePanel>
			</ResizableGroup>,
		);

		expect(screen.getByText("left panel")).toBeTruthy();
		expect(screen.getByText("right panel")).toBeTruthy();
		expect(screen.getAllByRole("separator")).toHaveLength(1);
	});

	it("gives the handle the orientation of its group", () => {
		render(
			<ResizableGroup id="nav-01-vertical" orientation="vertical">
				<ResizablePanel id="top">top</ResizablePanel>
				<ResizeHandle />
				<ResizablePanel id="bottom">bottom</ResizablePanel>
			</ResizableGroup>,
		);

		expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("horizontal");
	});

	it("draws the handle as the 1px separator line that turns on hover", () => {
		render(
			<ResizableGroup id="nav-01-handle" orientation="horizontal">
				<ResizablePanel id="left">left</ResizablePanel>
				<ResizeHandle />
				<ResizablePanel id="right">right</ResizablePanel>
			</ResizableGroup>,
		);

		const handle = screen.getByRole("separator");
		expect(handle.className).toContain("bg-separator");
		expect(handle.className).toContain("data-[separator=hover]:bg-focus");
		expect(handle.className).toContain("aria-[orientation=vertical]:w-px");
	});

	it("asks the panel-layout store for a group's saved sizes", () => {
		const load = vi.fn(() => ({ left: 30, right: 70 }));
		const save = vi.fn();

		render(
			<PanelLayoutProvider store={{ load, save }}>
				<ResizableGroup id="workspace-right-panels-w1" orientation="vertical">
					<ResizablePanel id="left">left</ResizablePanel>
					<ResizeHandle />
					<ResizablePanel id="right">right</ResizablePanel>
				</ResizableGroup>
			</PanelLayoutProvider>,
		);

		expect(load).toHaveBeenCalledWith("workspace-right-panels-w1");
	});
});
