/**
 * @feature RUN-06 TerminalView
 * Owns: tests for buffering output that arrives before the surface mounts, find and the ended banner.
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import { appError, err, ok, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Terminal, TerminalConnection } from "../../core/model.ts";
import { toast } from "../../ui/Toast.tsx";
import type { TerminalAppearance } from "./terminal-theme.ts";

const state = vi.hoisted(() => ({
	connection: { state: "loading" } as Loadable<TerminalConnection>,
	openUrl: vi.fn(),
	copyText: vi.fn(),
	restart: vi.fn(),
	terminals: { state: "ready", data: [] } as Loadable<Terminal[]>,
	settings: {
		terminal_font_family: "",
		terminal_font_size: 12,
		terminal_scrollback_limit_bytes: 10_000_000,
		experimental_tab_freak_mode: false,
	} as Record<string, unknown>,
	received: [] as Uint8Array[],
	appearance: null as TerminalAppearance | null,
	surface: { find: vi.fn(() => null), focus: vi.fn(), clear: vi.fn() },
}));

vi.mock("../../core/hooks.ts", () => ({
	useTerminalConnection: () => state.connection,
	useActions: () => ({
		app: { openUrl: state.openUrl, copyText: state.copyText },
		terminals: { restart: state.restart },
	}),
	useTerminals: () => state.terminals,
	useSetting: (key: string) => state.settings[key],
}));

vi.mock("./TerminalSurface.tsx", () => ({
	TerminalSurface: (props: {
		connection?: TerminalConnection;
		appearance?: TerminalAppearance;
		visible?: boolean;
		ended?: boolean;
		onOpenLink?: (url: string) => void;
		onCopy?: (text: string) => void;
		ref?: { current: typeof state.surface } | null;
	}) => {
		if (props.ref) props.ref.current = state.surface;
		state.appearance = props.appearance ?? null;
		useEffect(() => {
			if (!props.connection) return;
			return props.connection.onData((chunk) => state.received.push(chunk));
		}, [props.connection]);
		return (
			<div
				data-testid="terminal-surface"
				data-visible={String(props.visible)}
				data-ended={String(props.ended)}
			>
				<button type="button" onClick={() => props.onOpenLink?.("https://example.com")}>
					open-link
				</button>
				<button type="button" onClick={() => props.onCopy?.("picked text")}>
					copy-selection
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
const workspaceId = "w1" as WorkspaceId;

beforeEach(() => {
	state.connection = { state: "loading" };
	state.openUrl.mockReset();
	state.openUrl.mockResolvedValue(ok(undefined));
	state.copyText.mockReset();
	state.copyText.mockResolvedValue(ok(undefined));
	state.restart.mockReset();
	state.restart.mockResolvedValue(ok(undefined));
	state.terminals = { state: "ready", data: [] };
	state.settings = {
		terminal_font_family: "",
		terminal_font_size: 12,
		terminal_scrollback_limit_bytes: 10_000_000,
		experimental_tab_freak_mode: false,
	};
	state.received = [];
	state.appearance = null;
	state.surface.find.mockClear();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	delete document.documentElement.dataset.theme;
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

	it("subscribes again after a dispose, so StrictMode's second effect still gets output", () => {
		const source = fakeConnection();
		const buffered = new BufferedTerminalConnection(source);
		buffered.start();
		buffered.dispose();
		buffered.start();
		const chunk = new Uint8Array([9]);
		source.emit(chunk);
		const received: Uint8Array[] = [];
		buffered.onData((data) => received.push(data));
		expect(received).toEqual([chunk]);
		buffered.dispose();
	});

	it("delivers live output when the view renders inside StrictMode", () => {
		const source = fakeConnection();
		state.connection = { state: "ready", data: source };
		render(
			<StrictMode>
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />
			</StrictMode>,
		);
		const chunk = new Uint8Array([4, 5]);
		act(() => source.emit(chunk));
		expect(state.received).toContainEqual(chunk);
	});
});

describe("RUN-06 terminal view", () => {
	it("shows the ended banner with the exit code", async () => {
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 2 } }) };
		const onNewTerminal = vi.fn();
		render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
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
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		act(() => source.exit(7));
		await waitFor(() => expect(screen.getByText("Shell exited with status 7.")).toBeTruthy());
	});

	it("opens find on Cmd+F and keeps the surface mounted when hidden", () => {
		const source = fakeConnection();
		state.connection = { state: "ready", data: source };
		const { container, rerender } = render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				visible={false}
			/>,
		);
		expect(screen.getByTestId("terminal-surface").dataset.visible).toBe("false");
		const view = container.querySelector("[data-terminal-view]");
		expect(view).toBeTruthy();
		if (view) fireEvent.keyDown(view, { key: "f", metaKey: true });
		expect(screen.getByRole("textbox", { name: "Find in terminal" })).toBeTruthy();
		rerender(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				visible
			/>,
		);
		expect(screen.getByTestId("terminal-surface").dataset.visible).toBe("true");
	});

	it("keeps Ctrl+F and Ctrl+W for the shell and acts only on Cmd", () => {
		const onClose = vi.fn();
		state.connection = { state: "ready", data: fakeConnection() };
		const { container } = render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				onClose={onClose}
			/>,
		);
		const view = container.querySelector("[data-terminal-view]");
		if (!view) throw new Error("the terminal view did not render");

		fireEvent.keyDown(view, { key: "w", ctrlKey: true });
		fireEvent.keyDown(view, { key: "f", ctrlKey: true });
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox", { name: "Find in terminal" })).toBeNull();

		fireEvent.keyDown(view, { key: "w", metaKey: true });
		expect(onClose).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(view, { key: "f", metaKey: true });
		expect(screen.getByRole("textbox", { name: "Find in terminal" })).toBeTruthy();
	});

	it("starts a new terminal on Cmd+T", () => {
		const onNewTerminal = vi.fn();
		state.connection = { state: "ready", data: fakeConnection() };
		const { container } = render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				onNewTerminal={onNewTerminal}
			/>,
		);
		const view = container.querySelector("[data-terminal-view]");
		if (!view) throw new Error("the terminal view did not render");
		fireEvent.keyDown(view, { key: "t", metaKey: true });
		expect(onNewTerminal).toHaveBeenCalledTimes(1);
	});

	it("reads the terminal settings and reapplies them when the theme changes", async () => {
		document.documentElement.dataset.theme = "dark";
		state.settings = {
			terminal_font_family: "Fira Code",
			terminal_font_size: 18,
			terminal_scrollback_limit_bytes: 500_000,
			experimental_tab_freak_mode: false,
		};
		vi.stubGlobal("getComputedStyle", () => ({
			color:
				document.documentElement.dataset.theme === "light"
					? "rgb(250, 250, 250)"
					: "rgb(10, 10, 10)",
		}));
		state.connection = { state: "ready", data: fakeConnection() };
		render(<TerminalView terminalId={terminalId} workspaceId={workspaceId} />);

		expect(state.appearance?.fontFamily).toContain("Fira Code");
		expect(state.appearance?.fontSize).toBe(18);
		expect(state.appearance?.scrollbackLines).toBe(5_000);
		expect(state.appearance?.theme.background).toBe("rgb(10, 10, 10)");

		act(() => {
			document.documentElement.dataset.theme = "light";
		});
		await waitFor(() => expect(state.appearance?.theme.background).toBe("rgb(250, 250, 250)"));
	});

	it("enables New terminal for an ended terminal when the workspace is below the limit", async () => {
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 1 } }) };
		state.terminals = {
			state: "ready",
			data: [{ id: "other", kind: "terminal", endedAt: null } as Terminal],
		};
		render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				onNewTerminal={vi.fn()}
			/>,
		);
		const button = (await screen.findByRole("button", {
			name: "New terminal",
		})) as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		expect(screen.queryByText(/Maximum/)).toBeNull();
	});

	it("disables New terminal and names the limit only when the workspace is at it", async () => {
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 1 } }) };
		state.terminals = {
			state: "ready",
			data: Array.from(
				{ length: 5 },
				(_, index) => ({ id: `t${index}`, kind: "terminal", endedAt: null }) as Terminal,
			),
		};
		render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				onNewTerminal={vi.fn()}
			/>,
		);
		const button = (await screen.findByRole("button", {
			name: "New terminal",
		})) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByText("Maximum 5 terminals allowed")).toBeTruthy();
	});

	it("does not name the limit when the caller disables New terminal for another reason", async () => {
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 1 } }) };
		state.terminals = { state: "ready", data: [] };
		render(
			<TerminalView
				terminalId={terminalId}
				workspaceId={workspaceId}
				appearance={appearance}
				canStartNew={false}
			/>,
		);
		await screen.findByText("Shell exited with status 1.");
		expect(screen.queryByText(/Maximum/)).toBeNull();
	});

	it("restarts a finished shell from the banner", async () => {
		const source = fakeConnection({ ended: { exitCode: 1 } });
		state.connection = { state: "ready", data: source };
		state.restart.mockImplementation(async () => {
			source.ended = null;
			return ok(undefined);
		});
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		expect(await screen.findByText("Shell exited with status 1.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Restart" }));
		await waitFor(() => expect(state.restart).toHaveBeenCalledWith(terminalId));
		await waitFor(() => expect(screen.queryByText("Shell exited with status 1.")).toBeNull());
	});

	it("tells the user when restarting a finished shell fails, and keeps the banner", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		state.connection = { state: "ready", data: fakeConnection({ ended: { exitCode: 1 } }) };
		state.restart.mockResolvedValue(err(appError("pty_spawn", "The shell could not start.")));
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't restart the terminal", expect.anything()),
		);
		expect(screen.getByText("Shell exited with status 1.")).toBeTruthy();
		toastSpy.mockRestore();
	});

	it("tells the user when a confirmed terminal link cannot be opened", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		state.openUrl.mockResolvedValue(err(appError("open_failed", "No browser is set up.")));
		state.connection = { state: "ready", data: fakeConnection() };
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "open-link" }));
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't open the link", expect.anything()),
		);
		toastSpy.mockRestore();
	});

	it("copies the surface's selection through the app action and reports a failure", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		state.copyText.mockResolvedValue(err(appError("clipboard", "The clipboard is busy.")));
		state.connection = { state: "ready", data: fakeConnection() };
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "copy-selection" }));
		expect(state.copyText).toHaveBeenCalledWith("picked text");
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't copy the selection", expect.anything()),
		);
		toastSpy.mockRestore();
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
			render(
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
			);
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

		it("shows 'Invalid pattern' and does not search for a broken regular expression", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			render(
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
			);
			const input = openFind();
			fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
			fireEvent.change(input, { target: { value: "[" } });
			expect(screen.getByText("Invalid pattern")).toBeTruthy();
			expect(screen.queryByText("No results")).toBeNull();
			expect(state.surface.find).not.toHaveBeenCalled();
		});

		it("searches again when the case or regex option changes", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			render(
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
			);
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
			const { rerender } = render(
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
			);
			const input = openFind();
			fireEvent.change(input, { target: { value: "alpha" } });
			expect(state.surface.find).toHaveBeenCalledTimes(1);
			rerender(
				<TerminalView
					terminalId={terminalId}
					workspaceId={workspaceId}
					appearance={appearance}
					visible={false}
				/>,
			);
			expect(state.surface.find).toHaveBeenCalledTimes(1);
		});
	});

	it("asks before opening a terminal link", async () => {
		state.connection = { state: "ready", data: fakeConnection() };
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
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
		render(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		expect(screen.getByText("Couldn't open the terminal")).toBeTruthy();
		expect(screen.getByText("That terminal no longer exists.")).toBeTruthy();
	});
});
