/**
 * @feature COMP-01 Composer
 * Owns: The message box at the bottom of a chat: editor, toolbar (plus menu, model picker, mode
 * chips, context wheel, dictation) and the send or stop button.
 * Behaviour: ui-map.md 3.5 (Composer: TipTap editor, placeholder, toolbar, send or queue or save
 * button, stop button), 3.4 (send button icon and tooltip switch between 'Send message', 'Queue
 * message' and 'Save edit').
 * Our design choice: Narrow layouts move toolbar items into one 'More composer actions' menu. Until
 * those parts are built, the menu holds the MCP status check. The composer can minimise while a
 * file or diff tab is open, so the content gets the room. The accent colour is used once here: the
 * send button.
 * Must handle: Archived or read-only workspace (ArchivedComposerBar instead); agent working (send
 * becomes queue or steer, a stop button appears); draft restored when the app restarts; empty text
 * (send disabled); attachments only (send enabled); the sidecar is down (message kept, error shown,
 * nothing lost); focus returns to the editor after sending; Cmd+L focuses the editor.
 * Test first: With text typed and the agent idle, the send button is enabled; while the agent works
 * it reads 'Queue message' and a Cancel button shows.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { WrenchIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { ComposerEditor } from "./ComposerEditor.tsx";
import { ModeChips } from "./ModeChips.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PlusMenu } from "./PlusMenu.tsx";
import { SendButton, type SendButtonState } from "./SendButton.tsx";
import type { SendIntent, SendWith } from "./send-key.ts";
import { useDraftSync } from "./use-draft-sync.ts";

export interface ComposerProps {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}

function MoreIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="currentColor"
			stroke="none"
			aria-hidden="true"
		>
			<circle cx="3.5" cy="8" r="1.1" />
			<circle cx="8" cy="8" r="1.1" />
			<circle cx="12.5" cy="8" r="1.1" />
		</svg>
	);
}

export function Composer({ sessionId }: ComposerProps) {
	const actions = useActions();
	const { services } = useServices();
	const [editor, setEditor] = useState<Editor | null>(null);
	const [attachments, setAttachments] = useState<string[]>([]);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const live = useStore(services.sessions.store, (state) => state.liveStates[sessionId]);
	const sendKey = useStore(
		services.settings.store,
		(state) => state.values.message_send_key as string | undefined,
	);
	const followUp = useStore(
		services.settings.store,
		(state) => state.values.default_message_send_mode as string | undefined,
	);
	const working = live?.status === "working";
	const sendWith: SendWith = sendKey === "cmd-enter" ? "mod_enter" : "enter";
	const queueByDefault = followUp === "queue";
	const buttonState: SendButtonState = working ? (queueByDefault ? "queue" : "steer") : "send";
	const disabled = busy || (text.trim().length === 0 && attachments.length === 0);

	const restore = useCallback((draft: Draft) => {
		setAttachments([...draft.attachmentPaths]);
		setText(draft.text);
	}, []);

	useDraftSync({ sessionId, editor, attachmentPaths: attachments, onRestore: restore });

	useEffect(() => {
		if (editor === null) {
			setText("");
			return;
		}
		const update = () => setText(editor.getText());
		update();
		editor.on("update", update);
		return () => {
			editor.off("update", update);
		};
	}, [editor]);

	useEffect(() => {
		const focusEditor = (event: KeyboardEvent) => {
			if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "l") return;
			event.preventDefault();
			editor?.commands.focus();
		};
		window.addEventListener("keydown", focusEditor);
		return () => window.removeEventListener("keydown", focusEditor);
	}, [editor]);

	const send = async (intent: SendIntent) => {
		if (editor === null) return;
		const body = editor.getText();
		if (body.trim().length === 0 && attachments.length === 0) return;
		const delivery = intent === "submit" ? "auto" : queueByDefault ? "steer" : "queue";
		setBusy(true);
		try {
			const result = await actions.sessions.send(sessionId, body, attachments, delivery);
			if (!result.ok) {
				toastError("Couldn't send the message", result.error);
				return;
			}
			editor.commands.setContent("", { emitUpdate: false });
			setText("");
			setAttachments([]);
			await services.composer.clearDraft(sessionId);
			editor.commands.focus();
		} finally {
			setBusy(false);
		}
	};

	const stop = async () => {
		const result = await actions.sessions.cancel(sessionId);
		if (!result.ok) toastError("Couldn't cancel the agent", result.error);
	};

	const checkMcp = async () => {
		const result = await actions.mcp.refresh(sessionId);
		if (!result.ok) toastError("Couldn't check the MCP servers", result.error);
	};

	return (
		<div className="rounded-xl border border-border bg-surface shadow-xs">
			<div className="flex items-center gap-1 px-2 pt-2">
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
					<NotBuiltYet area="Attachments" variant="inline" resetKey={sessionId}>
						<PlusMenu sessionId={sessionId} />
					</NotBuiltYet>
					<NotBuiltYet area="Model" variant="inline" resetKey={sessionId}>
						<ModelPicker sessionId={sessionId} />
					</NotBuiltYet>
					<NotBuiltYet area="Modes" variant="inline" resetKey={sessionId}>
						<ModeChips sessionId={sessionId} />
					</NotBuiltYet>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<IconButton size="xs" label="MCP status" icon={<WrenchIcon />} onClick={checkMcp} />
					<Menu>
						<MenuTrigger asChild>
							<IconButton size="xs" label="More composer actions" icon={<MoreIcon />} />
						</MenuTrigger>
						<MenuContent align="end">
							<MenuItem onSelect={checkMcp}>MCP status</MenuItem>
						</MenuContent>
					</Menu>
				</div>
			</div>
			<ComposerEditor
				sessionId={sessionId}
				disabled={busy}
				onSubmit={(intent) => void send(intent)}
				sendWith={sendWith}
				onEditorReady={setEditor}
			/>
			<div className="flex items-center justify-end gap-1 px-2 pb-2">
				<SendButton
					state={buttonState}
					disabled={disabled}
					busy={busy}
					working={working}
					onSend={() => void send("submit")}
					onStop={() => void stop()}
				/>
			</div>
		</div>
	);
}
