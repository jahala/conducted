/**
 * @feature COMP-01 Composer
 * Owns: The message box at the bottom of a chat: editor, toolbar (plus menu, model picker, mode
 * chips, ACP options, context wheel, MCP status) and the send or stop button.
 * Behaviour: ui-map.md 3.5 (Composer: TipTap editor, placeholder, toolbar, send or queue button,
 * stop button), 3.4 (send button icon and tooltip switch between 'Send message', 'Queue message'
 * and 'Save edit').
 * Our design choice: Narrow composers (under 480px measured) move toolbar items into one 'More
 * composer actions' menu; wide ones show the MCP status button directly. The accent colour is used
 * once here: the send button.
 * Keyboard: Cmd+L focuses the editor and Cmd+Shift+Backspace cancels the running agent. Both are
 * command handlers (NAV-14), so a shortcut the user rebinds moves with it.
 * Must handle: agent working (send becomes queue or steer, a stop button appears); draft restored
 * when the app restarts; empty text (send disabled); attachments only (send enabled); the sidecar is
 * down (message kept, error shown, nothing lost); a draft write or clear that fails (error shown);
 * focus returns to the editor after sending; Cmd+L focuses the editor.
 * The editor loads the `@` trigger (COMP-04) and the `/` trigger (COMP-06) from this composer, so
 * both read the chat's service. A slash command the user picks is sent to the agent as a message;
 * a terminal-effect command shows the embedded-terminal bar and restarts the agent when done.
 * Moved: 'Save edit' belongs to the queued-message editor (CHAT-04); the composer minimising while
 * a content tab is open belongs to the tab strip (NAV-10); the new-workspace form reusing this
 * editor belongs to workspace creation (WS-01). The archived bar (ArchivedComposerBar) is not
 * rendered here: NAV-10's workspace gate replaces the whole screen of an archived workspace.
 * Dictation (COMP-08) is not mounted in this toolbar yet.
 * Test first: With text typed and the agent idle, the send button is enabled; while the agent works
 * it reads 'Queue message' and a Cancel button shows.
 */

import type { SlashCommand } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type Editor, Extension } from "@tiptap/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSlashCommands } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { WrenchIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toastError } from "../../ui/Toast.tsx";
<<<<<<< HEAD
<<<<<<< HEAD
import { AcpOptions } from "./AcpOptions.tsx";
=======
import { ContextWheel } from "../chat/ContextWheel.tsx";
>>>>>>> node/chat.14
=======
import { ContextWheel } from "../chat/ContextWheel.tsx";
import { AcpOptions } from "./AcpOptions.tsx";
>>>>>>> node/join.s1-ui-1
import { ComposerEditor } from "./ComposerEditor.tsx";
import { buildComposerExtensions } from "./composer-extensions.ts";
import { ModeChips } from "./ModeChips.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { isTerminalEffectCommand } from "./mentions/SlashCommandExtension.ts";
import { PlusMenu } from "./PlusMenu.tsx";
import { SendButton, type SendButtonState } from "./SendButton.tsx";
import type { SendIntent, SendWith } from "./send-key.ts";
import { useDraftSync } from "./use-draft-sync.ts";

export interface ComposerProps {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
	/** The editor once it exists, for a caller that needs to read or fill it. */
	onEditorReady?: (editor: Editor | null) => void;
}

/** Below this measured width the toolbar folds into the 'More composer actions' menu. */
export const NARROW_COMPOSER_WIDTH = 480;

/** Measures the composer so the toolbar can fold on narrow layouts. */
function useNarrowLayout(ref: RefObject<HTMLDivElement | null>): boolean {
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		const measure = () => setNarrow(node.getBoundingClientRect().width < NARROW_COMPOSER_WIDTH);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ref]);
	return narrow;
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

export function Composer({ sessionId, onEditorReady }: ComposerProps) {
	const actions = useActions();
	const { services } = useServices();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const narrow = useNarrowLayout(containerRef);
	const [editor, setEditorState] = useState<Editor | null>(null);
	const setEditor = useCallback(
		(next: Editor | null) => {
			setEditorState(next);
			onEditorReady?.(next);
		},
		[onEditorReady],
	);
	const [attachments, setAttachments] = useState<string[]>([]);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const live = useStore(services.sessions.store, (state) => state.liveStates[sessionId]);
	const draftError = useStore(services.composer.store, (state) => state.errors[sessionId]);
	const sendKey = useStore(
		services.settings.store,
		(state) => state.values.message_send_key as string | undefined,
	);
	const followUp = useStore(
		services.settings.store,
		(state) => state.values.default_message_send_mode as string | undefined,
	);
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const slash = useSlashCommands(sessionId);
	const working = live?.status === "working";
	const sendWith: SendWith = sendKey === "cmd-enter" ? "mod_enter" : "enter";
	const queueByDefault = followUp === "queue";
	const buttonState: SendButtonState = working ? (queueByDefault ? "queue" : "steer") : "send";
	const disabled = busy || (text.trim().length === 0 && attachments.length === 0);

	const slashCommands = useRef<readonly SlashCommand[]>([]);
	const slashAgent = useRef(session?.config.agent);
	const slashAcpAgent = useRef(session?.config.acpAgent);
	slashCommands.current = slash.state === "ready" ? slash.data : [];
	slashAgent.current = session?.config.agent;
	slashAcpAgent.current = session?.config.acpAgent;

	const attachTerminalOutput = useCallback(async () => {
		const added = await actions.attachments.addTerminalOutput(sessionId);
		if (!added.ok) {
			toastError("Couldn't attach the terminal output", added.error);
			return;
		}
		setAttachments((current) =>
			current.includes(added.value) ? current : [...current, added.value],
		);
	}, [actions, sessionId]);

	const runSlashCommand = useCallback(
		(command: SlashCommand) => {
			// A terminal-effect command shows its own bar; the user completes it there.
			if (isTerminalEffectCommand(command)) return;
			void actions.sessions.send(sessionId, `/${command.name}`, [], "auto").then((result) => {
				if (!result.ok) toastError("Couldn't run the slash command", result.error);
			});
		},
		[actions, sessionId],
	);

	const finishTerminalCommand = useCallback(() => {
		void actions.sessions.restartAgent(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't restart the agent", result.error);
		});
	}, [actions, sessionId]);

	const extensions = useMemo(
		() =>
			buildComposerExtensions({
				files: {
					// File rows wait on the repository file search (SIDE-22); the actions are live.
					search: () => [],
					actions: [
						{
							id: "terminal-output",
							label: "Attach current terminal output",
							onChoose: () => void attachTerminalOutput(),
						},
					],
				},
				pullRequests: { search: async () => [] },
				slash: {
					get commands() {
						return [...slashCommands.current];
					},
					get agent() {
						return slashAgent.current;
					},
					get acpAgent() {
						return slashAcpAgent.current;
					},
					onRun: runSlashCommand,
					onTerminalDone: finishTerminalCommand,
				},
				builders: {
					// The `#` trigger belongs to COMP-05, which is not built; leave it out.
					pullRequests: () => Extension.create({ name: "prMention" }),
				},
			}),
		[attachTerminalOutput, runSlashCommand, finishTerminalCommand],
	);

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

	const stop = useCallback(async () => {
		const result = await actions.sessions.cancel(sessionId);
		if (!result.ok) toastError("Couldn't cancel the agent", result.error);
	}, [actions, sessionId]);

	useEffect(() => {
		if (draftError === undefined) return;
		toastError("Couldn't save the draft", draftError);
	}, [draftError]);

	useCommandHandler("chat.focusInput", "area", () => {
		if (editor === null) return false;
		editor.commands.focus();
		return true;
	});

	useCommandHandler("chat.cancelAgent", "area", () => {
		if (!working) return false;
		void stop();
		return true;
	});

	const send = async (intent: SendIntent) => {
		if (editor === null) return;
		const body = editor.getText();
		if (body.trim().length === 0 && attachments.length === 0) return;
		const delivery = intent === "submit" ? "auto" : queueByDefault ? "steer" : "queue";
		setBusy(true);
		try {
			const result = await actions.sessions.send(sessionId, body, attachments, delivery);
			if (!result.ok) {
				// A cancel during an in-flight send restores the text to the draft; keep the editor.
				if (result.error.code === "cancelled") return;
				toastError("Couldn't send the message", result.error);
				return;
			}
			editor.commands.setContent("", { emitUpdate: false });
			setText("");
			setAttachments([]);
			const cleared = await services.composer.clearDraft(sessionId);
			if (!cleared.ok) toastError("Couldn't clear the draft", cleared.error);
			editor.commands.focus();
		} finally {
			setBusy(false);
		}
	};

	const checkMcp = async () => {
		const result = await actions.mcp.refresh(sessionId);
		if (!result.ok) toastError("Couldn't check the MCP servers", result.error);
	};

	return (
		<div
			ref={containerRef}
			className="rounded-xl border border-border bg-surface shadow-xs"
			data-narrow={narrow ? "true" : "false"}
		>
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
					<AcpOptions sessionId={sessionId} />
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<ContextWheel sessionId={sessionId} />
					{narrow ? (
						<Menu>
							<MenuTrigger asChild>
								<IconButton size="xs" label="More composer actions" icon={<MoreIcon />} />
							</MenuTrigger>
							<MenuContent align="end">
								<MenuItem onSelect={checkMcp}>MCP status</MenuItem>
							</MenuContent>
						</Menu>
					) : (
						<IconButton size="xs" label="MCP status" icon={<WrenchIcon />} onClick={checkMcp} />
					)}
				</div>
			</div>
			<ComposerEditor
				sessionId={sessionId}
				disabled={busy}
				onSubmit={(intent) => void send(intent)}
				sendWith={sendWith}
				onEditorReady={setEditor}
				extensions={extensions}
			/>
			<div className="flex items-center justify-end gap-1 px-2 pb-2">
				<SendButton
					state={buttonState}
					disabled={disabled}
					busy={busy}
					working={working}
					sendWith={sendWith}
					onSend={() => void send("submit")}
					onStop={() => void stop()}
				/>
			</div>
		</div>
	);
}
