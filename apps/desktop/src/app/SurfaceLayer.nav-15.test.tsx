/**
 * @feature NAV-15 Terminals and previews that survive tab switches
 * Owns: tests for the surface layer keeping surfaces mounted, placing them over their anchors, hiding
 * them without unmounting, and for the anchor reporting its box.
 * Test first: switching the active tab away and back does not unmount the terminal surface.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SurfaceAnchor,
	SurfaceLayer,
	type SurfaceRect,
	type SurfaceSpec,
} from "./SurfaceLayer.tsx";

const workspaceId = "w1" as WorkspaceId;

const rect = (x: number, y: number, width = 320, height = 240): SurfaceRect => ({
	x,
	y,
	width,
	height,
});

const domRect = (value: SurfaceRect): DOMRect =>
	({
		...value,
		left: value.x,
		top: value.y,
		right: value.x + value.width,
		bottom: value.y + value.height,
		toJSON: () => value,
	}) as DOMRect;

function TerminalProbe({ id, onUnmount }: { id: string; onUnmount?: () => void }) {
	useEffect(() => () => onUnmount?.(), [onUnmount]);
	return <div data-testid={`terminal-${id}`}>terminal {id}</div>;
}

function terminal(id: string, onUnmount?: () => void): SurfaceSpec {
	return {
		surfaceId: id,
		kind: "terminal",
		workspaceId,
		content: <TerminalProbe id={id} onUnmount={onUnmount} />,
	};
}

function browserPreview(id: string): SurfaceSpec {
	return {
		surfaceId: id,
		kind: "browser",
		workspaceId,
		content: <div data-testid={`preview-${id}`}>preview {id}</div>,
	};
}

function hostOf(id: string): HTMLElement {
	const host = screen.getByTestId(`terminal-${id}`).parentElement;
	if (host === null) throw new Error(`terminal ${id} has no surface host`);
	return host;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("NAV-15 SurfaceLayer", () => {
	it("keeps a terminal surface mounted when the active tab moves away and back", () => {
		const surfaces = [terminal("t1")];
		const view = render(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId={null}
			/>,
		);
		const first = screen.getByTestId("terminal-t1");
		expect(hostOf("t1").hidden).toBe(false);

		view.rerender(
			<SurfaceLayer surfaces={surfaces} placements={new Map()} focusSurfaceId={null} />,
		);
		expect(screen.getByTestId("terminal-t1")).toBe(first);
		expect(hostOf("t1").hidden).toBe(true);

		view.rerender(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId={null}
			/>,
		);
		expect(screen.getByTestId("terminal-t1")).toBe(first);
		expect(hostOf("t1").hidden).toBe(false);
	});

	it("keeps a browser preview mounted when another tab is active", () => {
		const surfaces = [browserPreview("b1")];
		const view = render(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["b1", rect(0, 0, 800, 600)]])}
				focusSurfaceId={null}
			/>,
		);
		const first = screen.getByTestId("preview-b1");

		view.rerender(
			<SurfaceLayer surfaces={surfaces} placements={new Map()} focusSurfaceId={null} />,
		);
		expect(screen.getByTestId("preview-b1")).toBe(first);
		expect(first.parentElement?.hidden).toBe(true);
	});

	it("places each surface over the window rectangle its anchor reported", () => {
		render(
			<SurfaceLayer
				surfaces={[terminal("t1")]}
				placements={new Map([["t1", rect(12, 34, 300, 200)]])}
				focusSurfaceId={null}
			/>,
		);
		const host = hostOf("t1");
		expect(host.style.position).toBe("fixed");
		expect(host.style.left).toBe("12px");
		expect(host.style.top).toBe("34px");
		expect(host.style.width).toBe("300px");
		expect(host.style.height).toBe("200px");
	});

	it("hides a surface whose anchor is missing, null or empty without unmounting it", () => {
		const surfaces = [terminal("t1")];
		const view = render(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId={null}
			/>,
		);
		expect(hostOf("t1").hidden).toBe(false);

		view.rerender(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", null]])}
				focusSurfaceId={null}
			/>,
		);
		expect(hostOf("t1").hidden).toBe(true);
		expect(hostOf("t1").getAttribute("aria-hidden")).toBe("true");

		view.rerender(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(0, 0, 0, 0)]])}
				focusSurfaceId={null}
			/>,
		);
		expect(screen.getByTestId("terminal-t1")).toBeTruthy();
		expect(hostOf("t1").hidden).toBe(true);
	});

	it("removes and disposes a surface when its tab closes", () => {
		const onUnmount = vi.fn();
		const view = render(
			<SurfaceLayer
				surfaces={[terminal("t1", onUnmount)]}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId={null}
			/>,
		);
		expect(onUnmount).not.toHaveBeenCalled();
		view.rerender(<SurfaceLayer surfaces={[]} placements={new Map()} focusSurfaceId={null} />);
		expect(screen.queryByTestId("terminal-t1")).toBeNull();
		expect(onUnmount).toHaveBeenCalledTimes(1);
	});

	it("moves focus into the visible surface that asked for it, but not into a hidden one", () => {
		const surfaces: SurfaceSpec[] = [
			{
				surfaceId: "t1",
				kind: "terminal",
				workspaceId,
				content: <input aria-label="terminal input" />,
			},
		];
		const view = render(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId={null}
			/>,
		);
		const input = screen.getByLabelText("terminal input");
		expect(document.activeElement).not.toBe(input);

		view.rerender(
			<SurfaceLayer
				surfaces={surfaces}
				placements={new Map([["t1", rect(10, 20)]])}
				focusSurfaceId="t1"
			/>,
		);
		expect(document.activeElement).toBe(input);

		view.rerender(<SurfaceLayer surfaces={surfaces} placements={new Map()} focusSurfaceId="t1" />);
		expect(document.activeElement).not.toBe(input);
	});

	it("never places two surfaces in one slot", () => {
		const slot = rect(10, 20);
		render(
			<SurfaceLayer
				surfaces={[terminal("t1"), terminal("t2")]}
				placements={
					new Map([
						["t1", slot],
						["t2", slot],
					])
				}
				focusSurfaceId={null}
			/>,
		);
		expect(hostOf("t1").hidden).toBe(false);
		expect(hostOf("t2").hidden).toBe(true);
	});
});

describe("NAV-15 SurfaceAnchor", () => {
	let box: SurfaceRect;

	beforeEach(() => {
		box = rect(12, 34, 300, 200);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => domRect(box));
	});

	it("reports its box on mount and null when it unmounts", () => {
		const onPlace = vi.fn();
		const view = render(<SurfaceAnchor surfaceId="t1" onPlace={onPlace} />);
		expect(onPlace).toHaveBeenLastCalledWith("t1", rect(12, 34, 300, 200));
		view.unmount();
		expect(onPlace).toHaveBeenLastCalledWith("t1", null);
	});

	it("reports a new box when the anchor resizes", () => {
		const observers: { current: ResizeObserverCallback | null } = { current: null };
		class FakeResizeObserver {
			constructor(callback: ResizeObserverCallback) {
				observers.current = callback;
			}
			observe(): void {}
			unobserve(): void {}
			disconnect(): void {}
		}
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);

		const onPlace = vi.fn();
		render(<SurfaceAnchor surfaceId="t1" onPlace={onPlace} />);
		expect(onPlace).toHaveBeenLastCalledWith("t1", rect(12, 34, 300, 200));

		box = rect(12, 34, 420, 180);
		const callback = observers.current as ResizeObserverCallback | null;
		callback?.([], {} as ResizeObserver);
		expect(onPlace).toHaveBeenLastCalledWith("t1", rect(12, 34, 420, 180));
	});

	it("reports a new box when the window resizes and stops after it unmounts", () => {
		const onPlace = vi.fn();
		const view = render(<SurfaceAnchor surfaceId="t1" onPlace={onPlace} />);

		box = rect(40, 60, 500, 300);
		window.dispatchEvent(new Event("resize"));
		expect(onPlace).toHaveBeenLastCalledWith("t1", rect(40, 60, 500, 300));

		view.unmount();
		const callsAfterUnmount = onPlace.mock.calls.length;
		window.dispatchEvent(new Event("resize"));
		expect(onPlace).toHaveBeenCalledTimes(callsAfterUnmount);
	});
});
