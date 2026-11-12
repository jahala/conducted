import { appError, err, ok, type SessionId } from "@conducted/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "../../core/api.ts";
import { draftFile } from "../../core/app-paths.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { ComposerService, type ComposerServiceDeps } from "../../core/services/composer.ts";
import type { FileStat, FileSystem, Platform } from "../../platform/platform.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { useDraftSync } from "./use-draft-sync.ts";

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
			return ok(files.has(path));
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
		async registerRoot() {
			return ok(undefined);
		},
		async includeSshConfig() {
			return ok(false);
		},
		async readBytes() {
			return ok(new Uint8Array());
		},
		async writeBytes() {
			return ok(undefined);
		},
		assetUrl(path: string) {
			return `asset://localhost/${encodeURIComponent(path)}`;
		},
		paths,
	};
	return { fs, files };
};

interface FakeEditor {
	text: string;
	listeners: Set<() => void>;
	on(event: string, callback: () => void): FakeEditor;
	off(event: string, callback: () => void): FakeEditor;
	getText(): string;
	commands: { setContent: (content: unknown) => void; focus: () => void };
	emit(): void;
}

const contentToText = (content: unknown): string => {
	if (typeof content === "string") return content;
	const doc = content as {
		content?: { content?: { type: string; text?: string }[] }[];
	};
	return (doc.content ?? [])
		.map((paragraph) =>
			(paragraph.content ?? [])
				.map((node) => (node.type === "hardBreak" ? "\n" : (node.text ?? "")))
				.join(""),
		)
		.join("\n\n");
};

const fakeEditor = (): FakeEditor => {
	const editor: FakeEditor = {
		text: "",
		listeners: new Set(),
		on(_event, callback) {
			editor.listeners.add(callback);
			return editor;
		},
		off(_event, callback) {
			editor.listeners.delete(callback);
			return editor;
		},
		getText: () => editor.text,
		commands: {
			setContent(content) {
				editor.text = contentToText(content);
			},
			focus() {},
		},
		emit() {
			for (const listener of editor.listeners) listener();
		},
	};
	return editor;
};

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	test.close();
});

const harness = () => {
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
	test.container.services.composer = composer;
	vi.spyOn(test.container.actions.sessions, "saveDraft").mockImplementation(
		(sessionId, draft: Draft) => composer.saveDraft(sessionId, draft),
	);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	const flush = () => {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback();
	};
	return { composer, files: fake.files, wrapper, flush };
};

describe("COMP-01 useDraftSync", () => {
	it("saves the first chat when switching, then restores the second chat's draft", async () => {
		const first = "chat-a" as SessionId;
		const second = "chat-b" as SessionId;
		const { composer, files, wrapper, flush } = harness();
		composer.saveDraft(second, { text: "second draft", attachmentPaths: ["/b.txt"] });
		flush();
		await composer.flush();
		const editor = fakeEditor();
		const restored: Draft[] = [];
		const { rerender } = renderHook(
			({ sessionId }: { sessionId: SessionId }) =>
				useDraftSync({
					sessionId,
					editor: editor as unknown as Editor,
					onRestore: (draft) => restored.push(draft),
				}),
			{ initialProps: { sessionId: first }, wrapper },
		);
		await waitFor(() =>
			expect(composer.store.getState().drafts[first]).toEqual({
				text: "",
				attachmentPaths: [],
			}),
		);
		act(() => {
			editor.text = "first chat text";
			editor.emit();
		});
		rerender({ sessionId: second });
		await waitFor(() => expect(editor.getText()).toBe("second draft"));
		flush();
		await composer.flush();
		expect(JSON.parse(files.get(draftFile(paths, first)) ?? "")).toEqual({
			text: "first chat text",
			attachmentPaths: [],
		});
		expect(restored.at(-1)).toEqual({ text: "second draft", attachmentPaths: ["/b.txt"] });
	});

	it("restores the draft's line breaks after a restart", async () => {
		const session = "chat-a" as SessionId;
		const { composer, wrapper, flush } = harness();
		composer.saveDraft(session, {
			text: "first line\nsecond line\n\nnew paragraph",
			attachmentPaths: [],
		});
		flush();
		await composer.flush();
		const editor = fakeEditor();
		renderHook(() => useDraftSync({ sessionId: session, editor: editor as unknown as Editor }), {
			wrapper,
		});
		await waitFor(() => expect(editor.getText()).toBe("first line\nsecond line\n\nnew paragraph"));
	});

	it("keeps keystrokes typed before the load resolves and never saves the previous chat's attachments", async () => {
		const first = "chat-a" as SessionId;
		const second = "chat-b" as SessionId;
		const { composer, files, wrapper, flush } = harness();
		composer.saveDraft(second, { text: "second draft", attachmentPaths: ["/b.png"] });
		flush();
		await composer.flush();

		const originalLoad = composer.loadDraft.bind(composer);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const load = vi.spyOn(composer, "loadDraft").mockImplementation(async (id) => {
			if (id === second) await gate;
			return originalLoad(id);
		});

		const editor = fakeEditor();
		const firstAttachments = ["/a.png"];
		const { rerender } = renderHook(
			({ sessionId, attachmentPaths }: { sessionId: SessionId; attachmentPaths: string[] }) =>
				useDraftSync({
					sessionId,
					editor: editor as unknown as Editor,
					attachmentPaths,
				}),
			{ initialProps: { sessionId: first, attachmentPaths: firstAttachments }, wrapper },
		);
		await waitFor(() => expect(composer.store.getState().drafts[first]).toBeDefined());

		// Switch to the second chat while its attachments prop is still the first chat's.
		rerender({ sessionId: second, attachmentPaths: firstAttachments });
		act(() => {
			editor.text = "typed before restore";
			editor.emit();
		});
		release();
		await waitFor(() => expect(load).toHaveBeenCalledWith(second));
		await waitFor(() => expect(composer.store.getState().drafts[second]).toBeDefined());

		// The saved text did not replace what the user typed.
		expect(editor.getText()).toBe("typed before restore");
		act(() => editor.emit());
		flush();
		await composer.flush();
		expect(JSON.parse(files.get(draftFile(paths, second)) ?? "")).toEqual({
			text: "typed before restore",
			attachmentPaths: ["/b.png"],
		});
	});

	it("tells the user when the saved draft cannot be read", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const session = "chat-a" as SessionId;
		const { files, wrapper } = harness();
		files.set(draftFile(paths, session), "{ not json");
		const editor = fakeEditor();
		renderHook(() => useDraftSync({ sessionId: session, editor: editor as unknown as Editor }), {
			wrapper,
		});
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't restore the draft", expect.anything()),
		);
		toastSpy.mockRestore();
	});

	it("saves an attachment change to the current chat", async () => {
		const session = "chat-a" as SessionId;
		const { composer, files, wrapper, flush } = harness();
		const editor = fakeEditor();
		const { rerender } = renderHook(
			({ attachmentPaths }: { attachmentPaths: string[] }) =>
				useDraftSync({
					sessionId: session,
					editor: editor as unknown as Editor,
					attachmentPaths,
				}),
			{ initialProps: { attachmentPaths: [] as string[] }, wrapper },
		);
		await waitFor(() =>
			expect(composer.store.getState().drafts[session]).toEqual({
				text: "",
				attachmentPaths: [],
			}),
		);
		rerender({ attachmentPaths: ["/shot.png"] });
		flush();
		await composer.flush();
		expect(JSON.parse(files.get(draftFile(paths, session)) ?? "")).toEqual({
			text: "",
			attachmentPaths: ["/shot.png"],
		});
	});
});
