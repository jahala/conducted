import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
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

	it("gives the 1px line an 8px hit area", () => {
		render(
			<ResizableGroup id="nav-01-hit-area" orientation="horizontal">
				<ResizablePanel id="left">left</ResizablePanel>
				<ResizeHandle />
				<ResizablePanel id="right">right</ResizablePanel>
			</ResizableGroup>,
		);

		const handle = screen.getByRole("separator");
		expect(handle.className).toContain("before:absolute");
		expect(handle.className).toContain("aria-[orientation=vertical]:before:-left-[3.5px]");
		expect(handle.className).toContain("aria-[orientation=vertical]:before:-right-[3.5px]");
		expect(handle.className).toContain("aria-[orientation=horizontal]:before:-top-[3.5px]");
		expect(handle.className).toContain("aria-[orientation=horizontal]:before:-bottom-[3.5px]");
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

		expect(load).toHaveBeenCalledWith("workspace-right-panels-w1", ["left", "right"]);
	});

	it("writes a group's layout to the store after the library changes it", () => {
		const save = vi.fn();
		const groupRef = createRef<GroupImperativeHandle>();
		// jsdom has no layout, so every panel measures zero and the library defers the group's layout
		// until it has a size (react-resizable-panels' defaultLayoutDeferred). Give the panels the
		// height a mounted group has, so this test exercises the library's real layout change path.
		const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);

		try {
			render(
				<PanelLayoutProvider store={{ load: () => null, save }}>
					<ResizableGroup id="workspace-right-panels-w1" groupRef={groupRef} orientation="vertical">
						<ResizablePanel id="left">left</ResizablePanel>
						<ResizeHandle />
						<ResizablePanel id="right">right</ResizablePanel>
					</ResizableGroup>
				</PanelLayoutProvider>,
			);

			act(() => {
				groupRef.current?.setLayout({ left: 40, right: 60 });
			});
		} finally {
			height.mockRestore();
		}

		expect(save).toHaveBeenCalledWith("workspace-right-panels-w1", { left: 40, right: 60 });
	});
});
