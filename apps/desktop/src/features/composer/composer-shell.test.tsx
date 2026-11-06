import { idleLiveState } from "@conducted/protocol";
import { appError, err, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import "../../test/dom-polyfills.ts";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { ComposerService, type ComposerServiceDeps } from "../../core/services/composer.ts";
import type { SessionsState } from "../../core/services/sessions.ts";
import type { SettingsState } from "../../core/services/settings.ts";
import type { FileStat, FileSystem, Platform } from "../../platform/platform.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { memoryPlatformForShape } from "../../test/memory-platform.ts";
import { toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";

// The composer reads its workspace (WS-07's linked folders) from the real workspace service, over a
// seeded workspace, as it does in the app.
let real: TestContainer | undefined;
let workspaceId: WorkspaceId;

beforeEach(async () => {
	real = createTestContainer();
	workspaceId = (await seedWorkspace(real.container)).id;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	real?.close();
	real = undefined;
});

const sessionId = "chat-1" as SessionId;
const paths = { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" };

const fakeFs = () => {
	const files = new Map<string, string>();
	const modified = new Map<string, number>();
	const fail = { write: false, trash: false };
	const statFor = (path: string): FileStat => ({
		path,
		isDirectory: false,
		isSymlink: false,
		size: new TextEncoder().encode(files.get(path) ?? "").length,
		modifiedAt: modified.get(path) ?? 0,
	});
	const fs: FileSystem = {
		async readText(path) {
			const text = files.get(path);
			return text === undefined ? err(appError("fs_not_found", "missing")) : ok(text);
		},
		async writeTextAtomic(path, text) {
			if (fail.write) return err(appError("fs_denied", "The draft file could not be written."));
			files.set(path, text);
			modified.set(path, modified.size + 1);
			return ok(undefined);
		},
		async exists(path) {
			return files.has(path);
		},
		async stat(path) {
			return files.has(path) ? ok(statFor(path)) : err(appError("fs_not_found", "missing"));
		},
		async mkdirp() {
			return ok(undefined);
		},
		async readDir() {
			return ok([...files.keys()].map(statFor));
		},
		async trash(path) {
			if (fail.trash) return err(appError("fs_denied", "The draft file could not be removed."));
			files.delete(path);
			return ok(undefined);
		},
		async registerRoot() {
			return ok(undefined);
		},
		paths,
	};
	return { fs, files, fail };
};

interface HarnessOptions {
	sendKey?: string;
	sendMode?: string;
	sendFails?: boolean;
	sendCancelled?: boolean;
	fake?: ReturnType<typeof fakeFs>;
}

const harness = (options: HarnessOptions = {}) => {
	if (real === undefined) throw new Error("The workspace container is built in beforeEach.");
	const workspace = real.container.services.workspace;
	const fake = options.fake ?? fakeFs();
	const callbacks = new Map<number, () => void>();
	let next = 1;
	const deps: ComposerServiceDeps = {
		platform: { fs: fake.fs } as Pick<Platform, "fs" | "dialogs" | "clipboard">,
		repos: {} as ComposerServiceDeps["repos"],
		setDebounce(callback) {
			const id = next++;
			callbacks.set(id, callback);
			return () => callbacks.delete(id);
		},
	};
	const composer = new ComposerService(deps);
	const sessions = createStore<SessionsState>(() => ({
		loaded: true,
		sessions: {},
		byWorkspace: {},
		liveStates: {},
		cancelling: {},
		events: {},
		progress: {},
		sending: {},
		acpConfigOptions: { [sessionId]: { state: "ready", data: [] } },
		openInteractions: {},
		viewingSessionId: null,
	}));
	const settings = createStore<SettingsState>(() => ({
		loaded: true,
		values: {
			message_send_key: options.sendKey ?? "enter",
			default_message_send_mode: options.sendMode ?? "steer",
			keybinding_overrides_v1: "",
		},
		dropped: [],
		warnings: [],
	}));
	const send = options.sendFails
		? vi.fn(async () => err(appError("sidecar_down", "The sidecar is not running.")))
		: options.sendCancelled
			? vi.fn(async () => err(appError("cancelled", "The message was cancelled.")))
			: vi.fn(async () => ok(undefined));
	const cancel = vi.fn(async () => ok(undefined));
	const refreshMcp = vi.fn(async () => ok(undefined));
	const settingsService = {
		store: settings,
		get: <T,>(key: string): T => settings.getState().values[key] as T,
	};
	const commands = {
		isEnabled: vi.fn(() => true),
		run: vi.fn(async () => ok(undefined)),
	};
	const agentCatalog = {
		store: createStore(() => ({ slashCommands: {} })),
		loadSlashCommands: vi.fn(async () => ok([])),
	};
	const platform = {
		app: { writeLog: vi.fn(), onDeepLink: () => () => {} },
		menu: {
			setShortcuts: vi.fn(async () => ok({ applied: [], rejected: [] })),
			onCommand: () => () => {},
		},
		// The composer listens for files dropped on the window (COMP-07).
		window: memoryPlatformForShape().window,
	};
	const container = {
		platform,
		services: {
			composer,
			sessions: { store: sessions },
			settings: settingsService,
			workspace,
			commands,
			agentCatalog,
		},
		actions: {
			sessions: {
				send,
				cancel,
				saveDraft: (id: SessionId, draft: { text: string; attachmentPaths: string[] }) =>
					composer.saveDraft(id, draft),
			},
			mcp: { refresh: refreshMcp },
		},
	} as unknown as Container;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	const flush = () => {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback();
	};
	const working = () =>
		sessions.setState((state) => ({
			liveStates: { ...state.liveStates, [sessionId]: { ...idleLiveState, status: "working" } },
		}));
	return {
		composer,
		sessions,
		settings,
		send,
		cancel,
		refreshMcp,
		wrapper,
		flush,
		working,
		fake,
	};
};

const seedDraft = (composer: ComposerService, text: string, attachmentPaths: string[] = []) => {
	composer.saveDraft(sessionId, { text, attachmentPaths });
};

const sendButton = () => screen.getByTestId("composer-send-button") as HTMLButtonElement;
const editor = () => screen.getByLabelText("composer");
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Forces the measured width the composer sees, so both toolbar layouts can be tested. */
const withWidth = (width: number) => {
	const original = HTMLElement.prototype.getBoundingClientRect;
	HTMLElement.prototype.getBoundingClientRect = () =>
		({
			width,
			height: 0,
			top: 0,
			left: 0,
			right: width,
			bottom: 0,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		}) as DOMRect;
	return () => {
		HTMLElement.prototype.getBoundingClientRect = original;
	};
};

describe("COMP-01 Composer", () => {
	it("enables the send button with text and sends it when the agent is idle", async () => {
		const { composer, send, wrapper, flush } = harness();
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.click(sendButton());
		await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, "hello", [], "auto"));
		flush();
	});

	it("reads 'Queue message' and shows Cancel while the agent works", async () => {
		const { composer, wrapper, working } = harness({ sendMode: "queue" });
		seedDraft(composer, "hello");
		working();
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(screen.getByRole("button", { name: "Queue message" })).toBeTruthy());
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	it("keeps the send button disabled with nothing to send", async () => {
		const { wrapper } = harness();
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(true));
	});

	it("enables the send button with only attachments", async () => {
		const { composer, wrapper } = harness();
		seedDraft(composer, "", ["/shot.png"]);
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
	});

	it("cancels the running agent from the stop button", async () => {
		const { composer, cancel, wrapper, working } = harness();
		seedDraft(composer, "hello");
		working();
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(cancel).toHaveBeenCalledWith(sessionId));
	});

	it("cancels the running agent on Cmd+Shift+Backspace", async () => {
		const { composer, cancel, wrapper, working } = harness();
		seedDraft(composer, "hello");
		working();
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
		fireEvent.keyDown(document, { key: "Backspace", metaKey: true, shiftKey: true });
		await waitFor(() => expect(cancel).toHaveBeenCalledWith(sessionId));
	});

	it("shows the MCP status button on a wide composer", async () => {
		const restore = withWidth(900);
		try {
			const { composer, wrapper } = harness();
			seedDraft(composer, "hello");
			render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
			await waitFor(() => expect(screen.getByRole("button", { name: "MCP status" })).toBeTruthy());
			expect(screen.queryByRole("button", { name: "More composer actions" })).toBeNull();
		} finally {
			restore();
		}
	});

	it("folds MCP status into the More composer actions menu on a narrow composer", async () => {
		const restore = withWidth(400);
		try {
			const { composer, refreshMcp, wrapper } = harness();
			seedDraft(composer, "hello");
			render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
			await waitFor(() =>
				expect(screen.getByRole("button", { name: "More composer actions" })).toBeTruthy(),
			);
			expect(screen.queryByRole("button", { name: "MCP status" })).toBeNull();
			const trigger = screen.getByRole("button", { name: "More composer actions" });
			trigger.focus();
			fireEvent.keyDown(trigger, { key: "Enter" });
			fireEvent.click(await screen.findByRole("menuitem", { name: "MCP status" }));
			await waitFor(() => expect(refreshMcp).toHaveBeenCalledWith(sessionId));
		} finally {
			restore();
		}
	});

	it("focuses the editor on Cmd+L", async () => {
		const { composer, wrapper } = harness();
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.keyDown(document, { key: "l", metaKey: true });
		await waitFor(() =>
			expect(document.activeElement?.getAttribute("aria-label")).toBe("composer"),
		);
	});

	it("restores a draft through the Composer after a restart", async () => {
		const firstRun = harness();
		firstRun.composer.saveDraft(sessionId, { text: "after restart", attachmentPaths: [] });
		firstRun.flush();
		await settle();

		const secondRun = harness({ fake: firstRun.fake });
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, {
			wrapper: secondRun.wrapper,
		});
		await waitFor(() => expect(editor().textContent).toBe("after restart"));
		expect(sendButton().disabled).toBe(false);
		secondRun.flush();
	});

	it("keeps the typed text and shows an error when sending fails", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { composer, send, wrapper } = harness({ sendFails: true });
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.click(sendButton());
		await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, "hello", [], "auto"));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't send the message", expect.anything()),
		);
		expect(editor().textContent).toBe("hello");
	});

	it("tells the user when clearing the draft after a send fails", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { composer, send, wrapper, flush, fake } = harness();
		seedDraft(composer, "hello");
		flush();
		await settle();
		fake.fail.trash = true;
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.click(sendButton());
		await waitFor(() => expect(send).toHaveBeenCalled());
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't clear the draft", expect.anything()),
		);
	});

	it("keeps the typed text and shows no error when a send is cancelled", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { composer, send, wrapper } = harness({ sendCancelled: true });
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.click(sendButton());
		await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, "hello", [], "auto"));
		await settle();
		expect(editor().textContent).toBe("hello");
		expect(toastSpy).not.toHaveBeenCalled();
	});

	it("tells the user when a draft write fails", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { composer, wrapper, flush, fake } = harness();
		fake.fail.write = true;
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(editor().textContent).toBe("hello"));
		flush();
		await settle();
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't save the draft", expect.anything()),
		);
	});

	it("sends with the opposite follow-up behaviour on Cmd+Enter when the default is steer", async () => {
		const { composer, send, wrapper, flush } = harness({ sendMode: "steer" });
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
		await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, "hello", [], "queue"));
		flush();
	});

	it("steers on Cmd+Enter when the default follow-up behaviour is queue", async () => {
		const { composer, send, wrapper, flush } = harness({ sendMode: "queue" });
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
		await waitFor(() => expect(send).toHaveBeenCalledWith(sessionId, "hello", [], "steer"));
		flush();
	});
});
