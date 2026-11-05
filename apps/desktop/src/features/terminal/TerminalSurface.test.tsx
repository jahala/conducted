/**
 * @feature RUN-06 Terminal surface
 * Owns: tests for the xterm lifecycle, output acknowledgement and appearance updates.
 * Test first: mounting then unmounting disposes the terminal and removes the resize observer.
 */
import { ok } from "@conducted/shared";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalConnection } from "../../core/model.ts";
import { findTerminalLinks, TerminalSurface } from "./TerminalSurface.tsx";
import type { TerminalAppearance } from "./terminal-theme.ts";

const xterm = vi.hoisted(() => {
	const terminal = {
		options: {} as Record<string, unknown>,
		open: vi.fn(),
		loadAddon: vi.fn(),
		focus: vi.fn(),
		write: vi.fn((_data: unknown, callback?: () => void) => callback?.()),
		resize: vi.fn(),
		onData: vi.fn(() => ({ dispose: vi.fn() })),
		onResize: vi.fn(() => ({ dispose: vi.fn() })),
		onExit: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
		hasSelection: vi.fn(() => false),
		getSelection: vi.fn(() => ""),
		clear: vi.fn(),
		scrollToLine: vi.fn(),
		select: vi.fn(),
		input: vi.fn(),
		dispose: vi.fn(),
		buffer: {
			normal: { length: 0, getLine: () => undefined },
			active: { getLine: () => undefined },
		},
	};
	const fit = { fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() };
	return { terminal, fit };
});

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(function Terminal() {
		return xterm.terminal;
	}),
}));
vi.mock("@xterm/addon-fit", () => ({
	FitAddon: vi.fn(function FitAddon() {
		return xterm.fit;
	}),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

function fakeConnection() {
	const listeners = new Set<(chunk: Uint8Array) => void>();
	const connection: TerminalConnection & { emit: (chunk: Uint8Array) => void } = {
		history: new Uint8Array(),
		ended: null,
		write: vi.fn(async () => ok(undefined)),
		resize: vi.fn(async () => ok(undefined)),
		onData: vi.fn((listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		ack: vi.fn(),
		onExit: vi.fn(() => () => {}),
		emit: (chunk) => {
			for (const listener of listeners) listener(chunk);
		},
	};
	return connection;
}

const appearance = (patch: Partial<TerminalAppearance> = {}): TerminalAppearance => ({
	fontFamily: "Menlo, monospace",
	fontSize: 12,
	scrollbackLines: 1000,
	theme: { background: "#141110", foreground: "#eae8e6" },
	...patch,
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("RUN-06 terminal surface", () => {
	it("finds http links on a terminal line", () => {
		expect(findTerminalLinks("see https://example.com/a, and http://x.y.")).toEqual([
			{ text: "https://example.com/a", start: 4, end: 25 },
			{ text: "http://x.y", start: 31, end: 41 },
		]);
	});

	it("disposes the terminal and disconnects the resize observer on unmount", () => {
		const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
		class FakeResizeObserver {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor() {
				observers.push(this);
			}
		}
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);

		const { unmount } = render(
			<TerminalSurface
				connection={fakeConnection()}
				appearance={appearance()}
				visible
				focusOnMount={false}
			/>,
		);
		expect(xterm.terminal.open).toHaveBeenCalledTimes(1);
		expect(xterm.terminal.registerLinkProvider).toHaveBeenCalledTimes(1);
		unmount();
		expect(xterm.terminal.dispose).toHaveBeenCalledTimes(1);
		expect(xterm.fit.dispose).toHaveBeenCalledTimes(1);
		expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
	});

	it("acknowledges each output chunk once it has been written to the screen", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		const connection = fakeConnection();
		render(
			<TerminalSurface
				connection={connection}
				appearance={appearance()}
				visible
				focusOnMount={false}
			/>,
		);
		const chunk = new Uint8Array([1, 2, 3]);
		act(() => connection.emit(chunk));
		expect(xterm.terminal.write).toHaveBeenLastCalledWith(chunk, expect.any(Function));
		expect(connection.ack).toHaveBeenCalledWith(3);
	});

	it("changes font and theme without creating a second terminal", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		const connection = fakeConnection();
		const { rerender } = render(
			<TerminalSurface
				connection={connection}
				appearance={appearance()}
				visible
				focusOnMount={false}
			/>,
		);
		const nextTheme = { background: "#ffffff", foreground: "#2c2826" };
		rerender(
			<TerminalSurface
				connection={connection}
				appearance={appearance({ fontSize: 15, theme: nextTheme })}
				visible
				focusOnMount={false}
			/>,
		);
		expect(xterm.terminal.open).toHaveBeenCalledTimes(1);
		expect(xterm.terminal.options.fontSize).toBe(15);
		expect(xterm.terminal.options.theme).toBe(nextTheme);
	});
});
