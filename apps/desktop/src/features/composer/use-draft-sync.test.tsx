import { appError, err, ok, type SessionId } from "@conducted/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { Draft } from "../../core/api.ts";
import { draftFile } from "../../core/app-paths.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { ComposerService, type ComposerServiceDeps } from "../../core/services/composer.ts";
import type { FileStat, FileSystem, Platform } from "../../platform/platform.ts";
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
	const container = { services: { composer } } as unknown as Container;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>{children}</ServicesProvider>
	);
	const flush = () => {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback();
	};
	return { composer, files: fake.files, wrapper, flush };
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("COMP-01 useDraftSync", () => {
	it("saves the first chat when switching, then restores the second chat's draft", async () => {
		const first = "chat-a" as SessionId;
		const second = "chat-b" as SessionId;
		const { composer, files, wrapper, flush } = harness();
		composer.saveDraft(second, { text: "second draft", attachmentPaths: ["/b.txt"] });
		flush();
		await settle();
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
		await settle();
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
		await settle();
		const editor = fakeEditor();
		renderHook(() => useDraftSync({ sessionId: session, editor: editor as unknown as Editor }), {
			wrapper,
		});
		await waitFor(() => expect(editor.getText()).toBe("first line\nsecond line\n\nnew paragraph"));
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
		await settle();
		expect(JSON.parse(files.get(draftFile(paths, session)) ?? "")).toEqual({
			text: "",
			attachmentPaths: ["/shot.png"],
		});
	});
});
