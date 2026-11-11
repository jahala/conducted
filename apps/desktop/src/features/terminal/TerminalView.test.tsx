/**
 * @feature RUN-06 TerminalView
 * Owns: tests for buffering output that arrives before the surface mounts, find and the ended banner.
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import { appError, err, ok, type TerminalId, type WorkspaceId } from "@conducted/shared";
import {
	act,
	cleanup,
	fireEvent,
	type RenderResult,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactElement, type ReactNode, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Terminal, TerminalConnection } from "../../core/model.ts";
import type { SettingValue } from "../../core/registries/settings.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import type { TerminalAppearance } from "./terminal-theme.ts";

const state = vi.hoisted(() => ({
	connection: { state: "loading" } as Loadable<TerminalConnection>,
	openUrl: vi.fn() as unknown as MockInstance,
	copyText: vi.fn() as unknown as MockInstance,
	restart: vi.fn() as unknown as MockInstance,
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

// seam: RUN-06 the real surface is xterm's browser-only DOM layer; the screen around it is what these tests own.
vi.mock("./TerminalSurface.tsx", () => ({
	TerminalSurface: (props: {
		connection?: TerminalConnection;
		appearance?: TerminalAppearance;
		visible?: boolean;
		ended?: boolean;
		onOpenLink?: (url: string) => void;
		onCopy?: (text: string) => void;
		onSelectionChange?: (text: string) => void;
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
				<button type="button" onClick={() => props.onSelectionChange?.("picked text")}>
					select-text
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

/** The real container the screen runs on; the outside calls it makes are spies on its Platform. */
let test: TestContainer;
let openUrl: MockInstance;
let writeText: MockInstance;
let restart: MockInstance;

/**
 * Renders the screen inside the real container, with the rows a test scripted. The hooks read the
 * container's stores, so the test writes what it would have mocked before: the terminal row, its
 * live connection and the settings.
 */
function renderView(ui: ReactElement): RenderResult {
	test.container.services.terminals.store.setState((current) => ({
		...current,
		connections: { ...current.connections, [terminalId]: state.connection },
		byWorkspace: {
			...current.byWorkspace,
			[workspaceId]: state.terminals.state === "ready" ? state.terminals.data : [],
		},
	}));
	test.container.services.settings.store.setState((current) => ({
		...current,
		values: { ...current.values, ...(state.settings as Record<string, SettingValue>) },
	}));
	return render(ui, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		),
	});
}

beforeEach(() => {
	test = createTestContainer();
	state.received = [];
	state.appearance = null;
	state.surface.find.mockClear();
	openUrl = vi.spyOn(test.memory.platform.opener, "openUrl");
	openUrl.mockResolvedValue(undefined);
	state.openUrl = openUrl;
	writeText = vi.spyOn(test.memory.platform.clipboard, "writeText");
	writeText.mockResolvedValue(undefined);
	state.copyText = writeText;
	restart = vi.spyOn(test.container.services.terminals, "restart");
	restart.mockResolvedValue(ok(undefined));
	state.restart = restart;
	state.connection = { state: "loading" };
	state.terminals = { state: "ready", data: [] };
	state.settings = {
		terminal_font_family: "",
		terminal_font_size: 12,
		terminal_scrollback_limit_bytes: 10_000_000,
		experimental_tab_freak_mode: false,
	};
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete document.documentElement.dataset.theme;
	test.close();
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
		renderView(
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
		renderView(
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
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		act(() => source.exit(7));
		await waitFor(() => expect(screen.getByText("Shell exited with status 7.")).toBeTruthy());
	});

	it("opens find on Cmd+F and keeps the surface mounted when hidden", () => {
		const source = fakeConnection();
		state.connection = { state: "ready", data: source };
		const { container, rerender } = renderView(
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
		const { container } = renderView(
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
		const { container } = renderView(
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
		renderView(<TerminalView terminalId={terminalId} workspaceId={workspaceId} />);

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
		renderView(
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
		renderView(
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
		renderView(
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
		renderView(
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
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't restart the terminal", expect.anything()),
		);
		expect(screen.getByText("Shell exited with status 1.")).toBeTruthy();
	});

	it("tells the user when a confirmed terminal link cannot be opened", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		state.openUrl.mockRejectedValue(new Error("No browser is set up."));
		state.connection = { state: "ready", data: fakeConnection() };
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "open-link" }));
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't open the link", expect.anything()),
		);
	});

	it("adds the selection to the workspace's chat as a terminal-selection file", async () => {
		const session = {
			id: "s1",
			workspaceId,
			title: "Fix the login redirect",
			config: {},
			agentSessionId: null,
			forkResumeNativeMessageId: null,
			unreadCount: 0,
			contextUsedTokens: null,
			queuePausedAt: null,
			closedAt: null,
			lastUserMessageAt: null,
			createdAt: 0,
			updatedAt: 0,
		} as unknown as import("../../core/model.ts").Session;
		test.container.services.sessions.store.setState((current) => ({
			...current,
			loaded: true,
			sessions: { ...current.sessions, s1: session },
			byWorkspace: { ...current.byWorkspace, [workspaceId]: [session.id] },
		}));
		const addText = vi
			.spyOn(test.container.services.composer, "addText")
			.mockResolvedValue(ok("/tmp/terminal-selection.txt"));
		state.connection = { state: "ready", data: fakeConnection() };
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "select-text" }));
		fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
		await waitFor(() =>
			expect(addText).toHaveBeenCalledWith(
				"s1",
				expect.stringMatching(/^terminal-selection-/),
				"picked text",
			),
		);
		expect(screen.queryByRole("button", { name: "Add to chat" })).toBeNull();
	});

	it("reports a selection that could not be attached", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const session = {
			id: "s1",
			workspaceId,
			title: null,
			config: {},
			agentSessionId: null,
			forkResumeNativeMessageId: null,
			unreadCount: 0,
			contextUsedTokens: null,
			queuePausedAt: null,
			closedAt: null,
			lastUserMessageAt: null,
			createdAt: 0,
			updatedAt: 0,
		} as unknown as import("../../core/model.ts").Session;
		test.container.services.sessions.store.setState((current) => ({
			...current,
			loaded: true,
			sessions: { ...current.sessions, s1: session },
			byWorkspace: { ...current.byWorkspace, [workspaceId]: [session.id] },
		}));
		vi.spyOn(test.container.services.composer, "addText").mockResolvedValue(
			err(appError("attachment_write_failed", "The file could not be written.")),
		);
		state.connection = { state: "ready", data: fakeConnection() };
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "select-text" }));
		fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith(
				"Failed to attach terminal selection",
				expect.anything(),
			),
		);
	});

	it("copies the surface's selection through the app action and reports a failure", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		state.copyText.mockRejectedValue(new Error("The clipboard is busy."));
		state.connection = { state: "ready", data: fakeConnection() };
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "copy-selection" }));
		expect(state.copyText).toHaveBeenCalledWith("picked text");
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't copy the selection", expect.anything()),
		);
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
			renderView(
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

		it("shows Conductor's 'Invalid regular expression' and does not search for a broken regular expression", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			renderView(
				<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
			);
			const input = openFind();
			fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
			fireEvent.change(input, { target: { value: "[" } });
			expect(screen.getByText("Invalid regular expression")).toBeTruthy();
			expect(screen.queryByText("No results")).toBeNull();
			expect(state.surface.find).not.toHaveBeenCalled();
		});

		it("searches again when the case or regex option changes", () => {
			state.connection = { state: "ready", data: fakeConnection() };
			renderView(
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
			const { rerender } = renderView(
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
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "open-link" }));
		expect(screen.getByText("Open link?")).toBeTruthy();
		expect(screen.getByText(/Open this terminal link\?/)).toBeTruthy();
		expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(state.openUrl).toHaveBeenCalledWith("https://example.com");
		await waitFor(() => expect(screen.queryByText("Open link?")).toBeNull());
	});

	it("shows a load error when the terminal cannot be found", () => {
		state.connection = {
			state: "error",
			error: { code: "terminal_unknown", message: "That terminal no longer exists." },
		};
		renderView(
			<TerminalView terminalId={terminalId} workspaceId={workspaceId} appearance={appearance} />,
		);
		expect(screen.getByText("Couldn't open the terminal")).toBeTruthy();
		expect(screen.getByText("That terminal no longer exists.")).toBeTruthy();
	});
});
