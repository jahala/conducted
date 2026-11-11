/**
 * @feature COMP-07 Attachments: drop, paste, pick
 * Owns: adding files to a chat's draft from the file picker, a drop and a paste, and turning long
 * pasted text into a text attachment. Removing one, and the busy flag the bar shows while a copy
 * runs.
 * Behaviour: ui-map.md 3.5 (attachments: file picker, drag and drop, paste; 'Paste copied files as
 * paths' Cmd+Shift+V; pasted text over 5000 characters becomes a text attachment when the setting
 * is on; images over 5 MB fail), services-map.md 5A.6.1 (the paste rule).
 * Our design choice: every picked, dropped or pasted file goes through
 * `Actions.attachments.add`, one file at a time, so a file that fails leaves the ones before it in
 * the draft. The service owns the file rules (a folder, an image over 5 MB), and the hook shows the
 * message it returns. Long pasted text uses the composer's `addText`, which stages it as a text
 * file. Adds run one after the other, so two drops keep their order.
 * A pasted image or screenshot has no path in WKWebView, so its bytes go to the composer's
 * `addBytes`, which writes them into the staging folder (`Platform.attachments.writeBytes`).
 * 'Paste copied files as paths' reads the files copied in Finder (`Platform.clipboard
 * .readFilePaths`) and types their paths into the editor, one space between each. The research
 * names the command but not how the paths are joined or what an empty clipboard shows; an empty
 * one shows "Attachments not available", as before.
 * Must handle: a folder (refused with "Folders can't be uploaded"); a failed copy (the others
 * still succeed); a cancelled picker; a pasted file with no path or no name; the setting that turns long-text
 * conversion off; a drop from the window, taken only by the composer of the chat on screen (the
 * sessions store's viewing chat), so a second chat in a split pane does not get the same files,
 * and by none while a window-level overlay such as the Feedback dialog is open.
 * Test first: dropping two files adds two paths to the draft in order.
 */
import { ok, type Result, type SessionId } from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { convertsToAttachment } from "../../core/composer-files.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting } from "../../core/hooks.ts";
import { toast, toastError } from "../../ui/Toast.tsx";

export interface UseAttachmentsProps {
	sessionId: SessionId;
	/** The editor whose DOM receives a paste and whose content receives pasted file paths. */
	editor: Editor | null;
	/** The draft's attachment paths, from the composer's own state. */
	attachmentPaths: readonly string[];
	onPathsChange: (paths: string[]) => void;
}

export interface AttachmentController {
	/** Adds dropped or picked files. A file without a path is reported and skipped. */
	add: (files: File[]) => Promise<void>;
	/** Adds paths, one at a time and in order. */
	addPaths: (paths: string[]) => Promise<void>;
	/** Opens the file picker, then adds what the user chose. */
	pick: () => Promise<void>;
	remove: (path: string) => Promise<void>;
	/** True while a copy runs, so the attachment bar shows its row. */
	busy: boolean;
}

type FileWithPath = File & { path?: string };

const pathOf = (file: File): string | null => {
	const path = (file as FileWithPath).path;
	return typeof path === "string" && path.length > 0 ? path : null;
};

/** Adds, removes and pastes a chat's attachments. */
export function useAttachments({
	sessionId,
	editor,
	attachmentPaths,
	onPathsChange,
}: UseAttachmentsProps): AttachmentController {
	const { services, platform } = useServices();
	const actions = useActions();
	const [pending, setPending] = useState(0);
	const pathsRef = useRef<readonly string[]>(attachmentPaths);
	const chain = useRef<Promise<void>>(Promise.resolve());
	const autoConvert = useSetting<boolean>("auto_convert_long_text");

	useEffect(() => {
		pathsRef.current = attachmentPaths;
	}, [attachmentPaths]);

	const update = useCallback(
		(next: readonly string[]) => {
			// The composer service also puts each added file in the stored draft, and the composer
			// follows that draft (CHAT-26), so a path can arrive twice: keep its first place.
			const unique = [...new Set(next)];
			pathsRef.current = unique;
			onPathsChange(unique);
		},
		[onPathsChange],
	);

	/** Runs one add after the ones before it and keeps the busy count around it. */
	const enqueue = useCallback((work: () => Promise<void>): Promise<void> => {
		setPending((count) => count + 1);
		const run = chain.current.then(work).finally(() => {
			setPending((count) => count - 1);
		});
		const guarded = run.catch(() => {
			toast.error("Couldn't add the attachment");
		});
		chain.current = guarded;
		return guarded;
	}, []);

	/** A file with no path, such as a pasted screenshot: its bytes are staged under its name. */
	const addPastedFile = useCallback(
		async (file: File): Promise<Result<string[]>> => {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const added = await services.composer.addBytes(sessionId, file.name, bytes);
			return added.ok ? ok([added.value.path]) : added;
		},
		[services.composer, sessionId],
	);

	/** Adds each file in order: a path through the attachment action, a pasted file by its bytes. */
	const addEach = useCallback(
		(items: readonly (string | File)[]): Promise<void> => {
			if (items.length === 0) return Promise.resolve();
			return enqueue(async () => {
				const added: string[] = [];
				for (const item of items) {
					const result =
						typeof item === "string"
							? await actions.attachments.add(sessionId, [item])
							: await addPastedFile(item);
					if (!result.ok) {
						toast.error(result.error.message);
						continue;
					}
					added.push(...result.value);
				}
				if (added.length > 0) update([...pathsRef.current, ...added]);
			});
		},
		[actions, addPastedFile, enqueue, sessionId, update],
	);

	const addPaths = useCallback((paths: string[]): Promise<void> => addEach(paths), [addEach]);

	const add = useCallback(
		(files: File[]): Promise<void> => addEach(files.map((file) => pathOf(file) ?? file)),
		[addEach],
	);

	const pick = useCallback(async (): Promise<void> => {
		let chosen: string[];
		try {
			chosen = await platform.dialogs.pickFiles({ title: "Add attachment", multiple: true });
		} catch {
			toast.error("Couldn't open the file picker");
			return;
		}
		await addPaths(chosen);
	}, [addPaths, platform.dialogs]);

	const remove = useCallback(
		async (path: string): Promise<void> => {
			const result = await services.composer.removeAttachment(sessionId, path);
			if (!result.ok) {
				toast.error(result.error.message);
				return;
			}
			update(pathsRef.current.filter((entry) => entry !== path));
		},
		[services.composer, sessionId, update],
	);

	const addPastedText = useCallback(
		(text: string): Promise<void> =>
			enqueue(async () => {
				const added = await services.composer.addText(sessionId, "pasted-text.txt", text);
				if (!added.ok) {
					toast.error(added.error.message);
					return;
				}
				update([...pathsRef.current, added.value]);
			}),
		[enqueue, services.composer, sessionId, update],
	);

	const pasteFilePaths = useCallback(async (): Promise<void> => {
		const copied = await platform.clipboard.readFilePaths();
		if (!copied.ok) {
			toastError("Attachments not available", copied.error);
			return;
		}
		if (copied.value.length === 0 || editor === null) {
			toast.error("Attachments not available");
			return;
		}
		editor.commands.insertContent(copied.value.join(" "));
	}, [editor, platform.clipboard]);

	useCommandHandler("chat.addAttachment", "area", () => {
		void pick();
		return true;
	});

	useCommandHandler("chat.pasteFilePaths", "area", () => {
		void pasteFilePaths();
		return true;
	});

	useEffect(() => {
		if (editor === null) return;
		const dom = editor.view.dom;
		const onPaste = (event: ClipboardEvent) => {
			const data = event.clipboardData;
			if (data === null) return;
			const files = Array.from(data.files);
			if (files.length > 0) {
				event.preventDefault();
				void add(files);
				return;
			}
			const text = data.getData("text/plain");
			if (autoConvert && convertsToAttachment(text)) {
				event.preventDefault();
				void addPastedText(text);
			}
		};
		dom.addEventListener("paste", onPaste);
		return () => dom.removeEventListener("paste", onPaste);
	}, [add, addPastedText, autoConvert, editor]);

	// A drop arrives from the window, so every mounted composer hears it. Only the chat on screen
	// takes it; with split panes, a second chat beside it would otherwise get the same files. A
	// window-level overlay (the Feedback dialog takes drops itself) covers the chat, so the chat
	// takes no drop while one is open.
	useEffect(
		() =>
			platform.window.onFileDrop((event) => {
				if (event.kind !== "drop") return;
				if (useOverlayStore.getState().open !== null) return;
				if (services.sessions.store.getState().viewingSessionId !== sessionId) return;
				void addPaths(event.paths);
			}),
		[addPaths, platform, services, sessionId],
	);

	return {
		add,
		addPaths,
		pick,
		remove,
		busy: pending > 0,
	};
}
