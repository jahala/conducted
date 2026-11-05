import { idleLiveState } from "@conducted/protocol";
import { appError, err, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import "../../test/dom-polyfills.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { ComposerService, type ComposerServiceDeps } from "../../core/services/composer.ts";
import type { SessionsState } from "../../core/services/sessions.ts";
import type { SettingsState } from "../../core/services/settings.ts";
import type { FileStat, FileSystem, Platform } from "../../platform/platform.ts";
import { Composer } from "./Composer.tsx";

afterEach(cleanup);

const sessionId = "chat-1" as SessionId;
const workspaceId = "ws-1" as WorkspaceId;
const paths = { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" };

const fakeFs = () => {
	const files = new Map<string, string>();
	const modified = new Map<string, number>();
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
			files.delete(path);
			return ok(undefined);
		},
		paths,
	};
	return { fs, files };
};

const harness = (options: { sendKey?: string; sendMode?: string } = {}) => {
	const fake = fakeFs();
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
		openInteractions: {},
		viewingSessionId: null,
	}));
	const settings = createStore<SettingsState>(() => ({
		loaded: true,
		values: {
			message_send_key: options.sendKey ?? "enter",
			default_message_send_mode: options.sendMode ?? "steer",
		},
		dropped: [],
		warnings: [],
	}));
	const send = vi.fn(async () => ok(undefined));
	const cancel = vi.fn(async () => ok(undefined));
	const refreshMcp = vi.fn(async () => ok(undefined));
	const container = {
		services: { composer, sessions: { store: sessions }, settings: { store: settings } },
		actions: {
			sessions: { send, cancel },
			mcp: { refresh: refreshMcp },
		},
	} as unknown as Container;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>{children}</ServicesProvider>
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
	return { composer, sessions, settings, send, cancel, refreshMcp, wrapper, flush, working };
};

const seedDraft = (composer: ComposerService, text: string, attachmentPaths: string[] = []) => {
	composer.saveDraft(sessionId, { text, attachmentPaths });
};

const sendButton = () => screen.getByTestId("composer-send-button") as HTMLButtonElement;

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

	it("offers the MCP status button and the More composer actions menu", async () => {
		const { composer, refreshMcp, wrapper } = harness();
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		expect(screen.getByRole("button", { name: "More composer actions" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "MCP status" }));
		await waitFor(() => expect(refreshMcp).toHaveBeenCalledWith(sessionId));
	});

	it("focuses the editor on Cmd+L", async () => {
		const { composer, wrapper } = harness();
		seedDraft(composer, "hello");
		render(<Composer workspaceId={workspaceId} sessionId={sessionId} />, { wrapper });
		await waitFor(() => expect(sendButton().disabled).toBe(false));
		fireEvent.keyDown(window, { key: "l", metaKey: true });
		await waitFor(() =>
			expect(document.activeElement?.getAttribute("aria-label")).toBe("composer"),
		);
	});
});
