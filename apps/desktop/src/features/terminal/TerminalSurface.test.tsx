/**
 * @feature RUN-06 Terminal surface
 * Owns: tests for the xterm lifecycle, output acknowledgement and appearance updates.
 * Test first: mounting then unmounting disposes the terminal and removes the resize observer.
 */
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalConnection } from "../../core/model.ts";
import { toast } from "../../ui/Toast.tsx";
import { findTerminalLinks, TerminalSurface } from "./TerminalSurface.tsx";
import type { TerminalAppearance } from "./terminal-theme.ts";

const xterm = vi.hoisted(() => {
	const state: {
		keyHandler: ((event: KeyboardEvent) => boolean) | null;
		dataHandler: ((data: string) => void) | null;
		resizeHandler: ((size: { cols: number; rows: number }) => void) | null;
	} = { keyHandler: null, dataHandler: null, resizeHandler: null };
	const terminal = {
		options: {} as Record<string, unknown>,
		open: vi.fn(),
		loadAddon: vi.fn(),
		focus: vi.fn(),
		write: vi.fn((_data: unknown, callback?: () => void) => callback?.()),
		resize: vi.fn(),
		onData: vi.fn((handler: (data: string) => void) => {
			state.dataHandler = handler;
			return { dispose: vi.fn() };
		}),
		onResize: vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
			state.resizeHandler = handler;
			return { dispose: vi.fn() };
		}),
		onExit: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
			state.keyHandler = handler;
		}),
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
	return { terminal, fit, state };
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
	xterm.state.keyHandler = null;
	xterm.state.dataHandler = null;
	xterm.state.resizeHandler = null;
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
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
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
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
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
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		const nextTheme = { background: "#ffffff", foreground: "#2c2826" };
		rerender(
			<TerminalSurface
				connection={connection}
				appearance={appearance({ fontSize: 15, theme: nextTheme })}
				visible
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		expect(xterm.terminal.open).toHaveBeenCalledTimes(1);
		expect(xterm.terminal.options.fontSize).toBe(15);
		expect(xterm.terminal.options.theme).toBe(nextTheme);
	});

	it("keeps the same terminal when the tab is hidden and shown, and moves focus on show", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		const connection = fakeConnection();
		const onCopy = vi.fn();
		// TerminalTabBody passes the same value for both props.
		const surface = (shown: boolean) => (
			<TerminalSurface
				connection={connection}
				appearance={appearance()}
				visible={shown}
				ended={false}
				focusOnMount={shown}
				onCopy={onCopy}
			/>
		);
		const { rerender, container } = render(surface(false));
		const screen = container.querySelector("[data-terminal-surface]");
		expect(xterm.terminal.focus).not.toHaveBeenCalled();

		rerender(surface(true));
		expect(xterm.terminal.focus).toHaveBeenCalledTimes(1);

		rerender(surface(false));
		rerender(surface(true));
		expect(xterm.terminal.focus).toHaveBeenCalledTimes(2);

		// One terminal was built and none was disposed, so the screen kept its content.
		expect(Terminal).toHaveBeenCalledTimes(1);
		expect(xterm.terminal.open).toHaveBeenCalledTimes(1);
		expect(xterm.terminal.dispose).not.toHaveBeenCalled();
		expect(xterm.fit.dispose).not.toHaveBeenCalled();
		expect(container.querySelector("[data-terminal-surface]")).toBe(screen);
	});

	it("focuses a terminal that is built already on screen", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		render(
			<TerminalSurface
				connection={fakeConnection()}
				appearance={appearance()}
				visible
				ended={false}
				focusOnMount
				onCopy={vi.fn()}
			/>,
		);
		expect(xterm.terminal.focus).toHaveBeenCalledTimes(1);
	});

	it("leaves Cmd+V to the paste event instead of writing the clipboard twice", () => {
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
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		const handled = xterm.state.keyHandler?.({
			type: "keydown",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			key: "v",
		} as KeyboardEvent);
		expect(handled).toBe(true);
		expect(connection.write).not.toHaveBeenCalled();
	});

	it("inserts a newline on Shift+Enter", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		render(
			<TerminalSurface
				connection={fakeConnection()}
				appearance={appearance()}
				visible
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		const handled = xterm.state.keyHandler?.({
			type: "keydown",
			shiftKey: true,
			key: "Enter",
		} as KeyboardEvent);
		expect(handled).toBe(false);
		expect(xterm.terminal.input).toHaveBeenCalledWith("\n", false);
	});

	it("copies the selection through the caller on Cmd+C", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		xterm.terminal.hasSelection.mockReturnValueOnce(true);
		xterm.terminal.getSelection.mockReturnValueOnce("picked text");
		const onCopy = vi.fn();
		render(
			<TerminalSurface
				connection={fakeConnection()}
				appearance={appearance()}
				visible
				ended={false}
				focusOnMount={false}
				onCopy={onCopy}
			/>,
		);
		const handled = xterm.state.keyHandler?.({
			type: "keydown",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			key: "c",
		} as KeyboardEvent);
		expect(handled).toBe(false);
		expect(onCopy).toHaveBeenCalledWith("picked text");
	});

	it("tells the user once when the terminal refuses input, however many keys fail", async () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const connection = fakeConnection();
		connection.write = vi.fn(async () => err(appError("pty_gone", "The shell is gone.")));
		render(
			<TerminalSurface
				connection={connection}
				appearance={appearance()}
				visible
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		xterm.state.dataHandler?.("a");
		xterm.state.dataHandler?.("b");
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't send input to the terminal", {
				id: "terminal-write",
				description: "The shell is gone.",
			}),
		);
		expect(new Set(toastSpy.mock.calls.map((call) => (call[1] as { id: string }).id)).size).toBe(1);
		toastSpy.mockRestore();
	});

	it("tells the user when the terminal refuses a resize", async () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			},
		);
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const connection = fakeConnection();
		connection.resize = vi.fn(async () => err(appError("pty_gone", "The shell is gone.")));
		render(
			<TerminalSurface
				connection={connection}
				appearance={appearance()}
				visible
				ended={false}
				focusOnMount={false}
				onCopy={vi.fn()}
			/>,
		);
		xterm.state.resizeHandler?.({ cols: 80, rows: 24 });
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith(
				"Couldn't resize the terminal",
				expect.objectContaining({ id: "terminal-resize" }),
			),
		);
		toastSpy.mockRestore();
	});
});
