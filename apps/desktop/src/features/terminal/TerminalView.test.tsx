/**
 * @feature RUN-06 TerminalView
 * Owns: tests for buffering output that arrives before the surface mounts, find and the ended banner.
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import { ok, type TerminalId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { TerminalConnection } from "../../core/model.ts";
import type { TerminalAppearance } from "./terminal-theme.ts";

const state = vi.hoisted(() => ({
	connection: { state: "loading" } as Loadable<TerminalConnection>,
	openUrl: vi.fn(),
	surface: { find: vi.fn(() => null), focus: vi.fn(), clear: vi.fn() },
}));

vi.mock("../../core/hooks.ts", () => ({
	useTerminalConnection: () => state.connection,
	useActions: () => ({ app: { openUrl: state.openUrl } }),
}));

vi.mock("./TerminalSurface.tsx", () => ({
	TerminalSurface: (props: {
		visible?: boolean;
		onOpenLink?: (url: string) => void;
		ref?: { current: typeof state.surface } | null;
	}) => {
		if (props.ref) props.ref.current = state.surface;
		return (
			<div data-testid="terminal-surface" data-visible={String(props.visible)}>
				<button type="button" onClick={() => props.onOpenLink?.("https://example.com")}>
					open-link
				</button>
			</div>
		);
	},
}));

const { BufferedTerminalConnection, TerminalView } = await import("./TerminalView.tsx");

function fakeConnection(patch: Partial<TerminalConnection> = {}) {
	const listeners = new Set<(chunk: Uint8Array) => void>();
	const exitListeners = new Set<(exitCode: number | null) => void>();
	const connection = {
		history: new Uint8Array(),
		ended: null,
		write: vi.fn(async () => ok(undefined)),
		resize: vi.fn(async () => ok(undefined)),
		onData: vi.fn((listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		ack: vi.fn(),
		onExit: vi.fn((listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		}),
		emit: (chunk: Uint8Array) => {
			for (const listener of listeners) listener(chunk);
		},
		exit: (code: number | null) => {
			for (const listener of exitListeners) listener(code);
		},
		...patch,
	};
	return connection;
}

const appearance: TerminalAppearance = {
	fontFamily: "Menlo, monospace",
	fontSize: 12,
	scrollbackLines: 1000,
	theme: { background: "#141110", foreground: "#eae8e6" },
};

const terminalId = "t1" as TerminalId;

beforeEach(() => {
	state.connection = { state: "loading" };
	state.openUrl.mockClear();
	state.surface.find.mockClear();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("RUN-06 terminal view buffering", () => {
	it("replays output that arrived before the surface subscribed and acknowledges it once", () => {
		const source = fakeConnection();
		const buffered = new BufferedTerminalConnection(source);
		buffered.start();
		const chunk = new Uint8Array([4, 5]);
		source.emit(chunk);
		expect(source.ack).not.toHaveBeenCalled();

		const received: Uint8Array[] = [];
		const unsubscribe = buffered.onData((data) => {
			received.push(data);
			buffered.ack(data.byteLength);
		});
		expect(received).toEqual([chunk]);
		expect(source.ack).toHaveBeenCalledTimes(1);
		expect(source.ack).toHaveBeenCalledWith(2);

		unsubscribe();
		buffered.dispose();
		source.emit(new Uint8Array([6]));
		expect(received).toHaveLength(1);
	});
});

describe("RUN-06 terminal view", () => {
	it("shows the ended banner with the exit code", async () => {
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 2 } }) };
		const onNewTerminal = vi.fn();
		render(
			<TerminalView
				terminalId={terminalId}
				appearance={appearance}
				canStartNew
				onNewTerminal={onNewTerminal}
			/>,
		);
		expect(await screen.findByText("Shell exited with status 2.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(onNewTerminal).toHaveBeenCalledTimes(1);
	});

	it("updates the banner when the process exits", async () => {
		const source = fakeConnection();
		state.connection = { state: "ready", data: source };
		render(<TerminalView terminalId={terminalId} appearance={appearance} />);
		act(() => source.exit(7));
		await waitFor(() => expect(screen.getByText("Shell exited with status 7.")).toBeTruthy());
	});

	it("opens find on Cmd+F and keeps the surface mounted when hidden", () => {
		const source = fakeConnection();
		state.connection = { state: "ready", data: source };
		const { container, rerender } = render(
			<TerminalView terminalId={terminalId} appearance={appearance} visible={false} />,
		);
		expect(screen.getByTestId("terminal-surface").dataset.visible).toBe("false");
		const view = container.querySelector("[data-terminal-view]");
		expect(view).toBeTruthy();
		if (view) fireEvent.keyDown(view, { key: "f", metaKey: true });
		expect(screen.getByRole("textbox", { name: "Find in terminal" })).toBeTruthy();
		rerender(<TerminalView terminalId={terminalId} appearance={appearance} visible />);
		expect(screen.getByTestId("terminal-surface").dataset.visible).toBe("true");
	});

	describe("find", () => {
		function openFind() {
			const view = document.querySelector("[data-terminal-view]");
			if (!view) throw new Error("the terminal view did not render");
			fireEvent.keyDown(view, { key: "f", metaKey: true });
			return screen.getByRole("textbox", { name: "Find in terminal" });
		}

		it("searches from the top when the query changes while find is open", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			render(<TerminalView terminalId={terminalId} appearance={appearance} />);
			const input = openFind();
			expect(state.surface.find).not.toHaveBeenCalled();
			fireEvent.change(input, { target: { value: "alpha" } });
			expect(state.surface.find).toHaveBeenCalledTimes(1);
			expect(state.surface.find).toHaveBeenLastCalledWith(
				{ query: "alpha", caseSensitive: false, regex: false },
				"next",
				null,
			);
		});

		it("searches again when the case or regex option changes", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			render(<TerminalView terminalId={terminalId} appearance={appearance} />);
			const input = openFind();
			fireEvent.change(input, { target: { value: "alpha" } });
			fireEvent.click(screen.getByRole("button", { name: "Match case" }));
			expect(state.surface.find).toHaveBeenLastCalledWith(
				{ query: "alpha", caseSensitive: true, regex: false },
				"next",
				null,
			);
			fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
			expect(state.surface.find).toHaveBeenLastCalledWith(
				{ query: "alpha", caseSensitive: true, regex: true },
				"next",
				null,
			);
			expect(state.surface.find).toHaveBeenCalledTimes(3);
		});

		it("does not search again when an unrelated render happens while find is open", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			const { rerender } = render(<TerminalView terminalId={terminalId} appearance={appearance} />);
			const input = openFind();
			fireEvent.change(input, { target: { value: "alpha" } });
			expect(state.surface.find).toHaveBeenCalledTimes(1);
			rerender(<TerminalView terminalId={terminalId} appearance={appearance} visible={false} />);
			expect(state.surface.find).toHaveBeenCalledTimes(1);
		});
	});

	it("asks before opening a terminal link", async () => {
		state.connection = { state: "ready", data: fakeConnection() };
		render(<TerminalView terminalId={terminalId} appearance={appearance} />);
		fireEvent.click(screen.getByRole("button", { name: "open-link" }));
		expect(screen.getByText("Open this terminal link?")).toBeTruthy();
		expect(screen.getByText("https://example.com")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(state.openUrl).toHaveBeenCalledWith("https://example.com");
		await waitFor(() => expect(screen.queryByText("Open this terminal link?")).toBeNull());
	});

	it("shows a load error when the terminal cannot be found", () => {
		state.connection = {
			state: "error",
			error: { code: "terminal_unknown", message: "That terminal no longer exists." },
		};
		render(<TerminalView terminalId={terminalId} appearance={appearance} />);
		expect(screen.getByText("Couldn't open the terminal")).toBeTruthy();
		expect(screen.getByText("That terminal no longer exists.")).toBeTruthy();
	});
});
