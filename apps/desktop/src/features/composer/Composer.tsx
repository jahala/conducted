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
 * focus returns to the editor after sending; Cmd+L focuses the editor; the file list fails to load
 * (error shown) or an older list arrives after a newer one (dropped); a terminal for a slash
 * command that cannot be created (shown on the bar, with Reopen terminal).
 * The editor loads the `@` trigger (COMP-04) and the `/` trigger (COMP-06) from this composer, so
 * both read the chat's service. The `@` menu lists the workspace's files and its linked folders,
 * read again each time the menu opens, and offers "Attach current terminal output" and "Select
 * working directories" (WS-07). The `#` trigger is left out until COMP-05 builds pull request
 * search. A slash command the user picks does what `slashCommandAction` says: /clear opens a new
 * chat tab (the tab strip's own Cmd+T handler) and closes this one, /restart restarts the agent,
 * /compact asks a Codex chat to summarise its history, /add-dir opens the Link workspaces and
 * directories dialog (WS-07), /plan and /fast run the plan and fast mode toggles of the toolbar,
 * a command the agent lists is sent to it, and any other says it is not available. A
 * terminal-effect command opens a terminal that runs it and shows the terminal command bar above
 * the composer; the bar follows
 * that terminal (closed, finished, failed) and
 * restarts the agent when the user clicks Done. Attachments are added from the '+' menu, a drop or
 * a paste by the COMP-07 hook, shown in AttachmentBar, and materialised when the message is sent.
 * The '+' menu's "Link issue", Cmd+I and the palette's "Link issue" open the Link issue dialog
 * (PR-09) of the chat on screen; the issue it links joins the same attachment list.
 * Moved: 'Save edit' belongs to the queued-message editor (CHAT-04); the composer minimising while
 * a content tab is open belongs to the tab strip (NAV-10); the new-workspace form reusing this
 * editor belongs to workspace creation (WS-01). The archived bar (ArchivedComposerBar) is not
 * rendered here: NAV-10's workspace gate replaces the whole screen of an archived workspace.
 * Dictation (COMP-08) is not mounted in this toolbar yet.
 * Test first: With text typed and the agent idle, the send button is enabled; while the agent works
 * it reads 'Queue message' and a Cancel button shows.
 */

import type { SlashCommand } from "@conducted/protocol";
import type { SessionId, TerminalId, WorkspaceId } from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler, useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSlashCommands, useWorkspace } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { WrenchIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { ContextWheel } from "../chat/ContextWheel.tsx";
import { AcpOptions } from "./AcpOptions.tsx";
import { AttachmentBar } from "./AttachmentBar.tsx";
import { ComposerEditor } from "./ComposerEditor.tsx";
import { buildComposerExtensions } from "./composer-extensions.ts";
import { FastModeUnavailableBanner } from "./FastModeUnavailableBanner.tsx";
import { LinkDirectoriesDialog } from "./LinkDirectoriesDialog.tsx";
import { LinkIssueDialog } from "./LinkIssueDialog.tsx";
import { ModeChips } from "./ModeChips.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import type { FileMentionItem } from "./mentions/FileMention.ts";
import {
	COMMAND_UNAVAILABLE,
	PLAN_MODE_UNAVAILABLE,
	type SlashListState,
	slashCommandAction,
	terminalCommandLine,
} from "./mentions/SlashCommandExtension.ts";
import { PlusMenu } from "./PlusMenu.tsx";
import { SendButton, type SendButtonState } from "./SendButton.tsx";
import type { SendIntent, SendWith } from "./send-key.ts";
import { TerminalCommandBar } from "./TerminalCommandBar.tsx";
import { useAttachments } from "./use-attachments.ts";
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

/** A terminal-effect slash command and the terminal that runs it. */
interface TerminalRun {
	command: SlashCommand;
	/** Null when the terminal could not be created. */
	terminalId: TerminalId | null;
	/** Why the terminal could not be created. */
	error: string | null;
}

/** The terminal command bar, following the terminal that runs the command. */
function TerminalCommandStatus({
	workspaceId,
	run,
	onReopen,
	onDone,
}: {
	workspaceId: WorkspaceId;
	run: TerminalRun;
	onReopen: () => void;
	onDone: () => void;
}) {
	const { services } = useServices();
	const terminal = useStore(services.terminals.store, (state) =>
		run.terminalId === null
			? undefined
			: state.byWorkspace[workspaceId]?.find((entry) => entry.id === run.terminalId),
	);
	const exitCode = terminal?.exitCode ?? null;
	const ended = terminal !== undefined && terminal.endedAt !== null;
	// The command's `exit` ends the shell with its exit code. A terminal the user closed, or one
	// killed by a signal, ends with no code: the command did not finish.
	const finished = ended && exitCode !== null;
	const closed = terminal === undefined || (ended && exitCode === null);
	const failed = finished && exitCode !== 0;
	return (
		<TerminalCommandBar
			command={run.command.name}
			phase={finished ? "finished" : "running"}
			error={run.error ?? (failed ? `The command exited with code ${exitCode}.` : null)}
			terminalClosed={closed}
			onReopen={onReopen}
			onDone={onDone}
		/>
	);
}

export function Composer({ workspaceId, sessionId, onEditorReady }: ComposerProps) {
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
	const [linkDialogOpen, setLinkDialogOpen] = useState(false);
	const [issueDialogOpen, setIssueDialogOpen] = useState(false);
	const attachmentsController = useAttachments({
		sessionId,
		editor,
		attachmentPaths: attachments,
		onPathsChange: setAttachments,
	});
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
	const workspaceRow = useWorkspace(workspaceId);
	// Read through a ref, like the file list: a rename or pin replaces the row with new arrays, and
	// the editor must not be rebuilt under the user each time (it would drop unsaved typing).
	const linkedPaths = useRef<readonly string[]>([]);
	linkedPaths.current = workspaceRow.state === "ready" ? workspaceRow.data.linkedPaths : [];
	const slash = useSlashCommands(sessionId);
	const working = live?.status === "working";
	const sendWith: SendWith = sendKey === "cmd-enter" ? "mod_enter" : "enter";
	const queueByDefault = followUp === "queue";
	const buttonState: SendButtonState = working ? (queueByDefault ? "queue" : "steer") : "send";
	const disabled = busy || (text.trim().length === 0 && attachments.length === 0);

	const runCommand = useRunCommandHandlers();
	const slashCommands = useRef<readonly SlashCommand[]>([]);
	const slashAgent = useRef(session?.config.agent);
	const slashAcpAgent = useRef(session?.config.acpAgent);
	const slashListState = useRef<SlashListState>({ state: "loading" });
	slashCommands.current = slash.state === "ready" ? slash.data : [];
	slashAgent.current = session?.config.agent;
	slashAcpAgent.current = session?.config.acpAgent;
	slashListState.current =
		slash.state === "error"
			? { state: "error", message: slash.error.message }
			: { state: slash.state };
	const [terminalRun, setTerminalRun] = useState<TerminalRun | null>(null);

	// The '@' file list. It is read again each time the menu opens; only the newest answer is kept.
	const files = useRef<FileMentionItem[]>([]);
	const fileRequest = useRef(0);
	const editorRef = useRef<Editor | null>(null);
	editorRef.current = editor;
	// A list read for another workspace must not show here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the reset runs when the workspace changes
	useEffect(() => {
		fileRequest.current += 1;
		files.current = [];
	}, [workspaceId]);
	const loadFiles = useCallback(async () => {
		fileRequest.current += 1;
		const request = fileRequest.current;
		const listed = await services.workspaceFiles.tree(workspaceId);
		if (request !== fileRequest.current) return;
		if (!listed.ok) {
			toastError("Couldn't list the workspace files", listed.error);
			return;
		}
		files.current = listed.value.map((entry) => ({
			path: entry.path,
			isDirectory: entry.isDirectory,
		}));
		// Redraw an open '@' menu with the list that just arrived.
		const view = editorRef.current?.isDestroyed === false ? editorRef.current.view : null;
		view?.dispatch(view.state.tr);
	}, [services, workspaceId]);

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

	const startTerminalCommand = useCallback(
		async (command: SlashCommand) => {
			const line = terminalCommandLine(slashAgent.current, command);
			if (line === null) {
				toast.error(COMMAND_UNAVAILABLE);
				return;
			}
			const created = await actions.terminals.create(workspaceId, { command: line });
			setTerminalRun({
				command,
				terminalId: created.ok ? created.value.id : null,
				error: created.ok ? null : created.error.message,
			});
		},
		[actions, workspaceId],
	);

	const runSlashCommand = useCallback(
		(command: SlashCommand) => {
			const action = slashCommandAction(command, slashCommands.current, slashAgent.current);
			switch (action.kind) {
				case "terminal":
					void startTerminalCommand(command);
					return;
				case "clear":
					// The tab strip's own new-chat handler opens the fresh chat and shows it.
					if (!runCommand("chat.newTab")) {
						toast.error(COMMAND_UNAVAILABLE);
						return;
					}
					void actions.sessions.close(sessionId).then((result) => {
						if (!result.ok) toastError("Couldn't close the chat", result.error);
					});
					return;
				case "restart":
					void actions.sessions.restartAgent(sessionId).then((result) => {
						if (!result.ok) toastError("Couldn't restart the agent", result.error);
					});
					return;
				case "linkDirectories":
					setLinkDialogOpen(true);
					return;
				case "compact":
					void actions.sessions.compact(sessionId).then((result) => {
						if (!result.ok) toastError("Couldn't compact the chat", result.error);
					});
					return;
				case "screen":
					// The same handler the toolbar's plan chip and fast toggle register.
					if (!runCommand(action.commandId)) {
						toast.error(
							action.commandId === "chat.togglePlanMode"
								? PLAN_MODE_UNAVAILABLE
								: COMMAND_UNAVAILABLE,
						);
					}
					return;
				case "send":
					void actions.sessions.send(sessionId, action.text, [], "auto").then((result) => {
						if (!result.ok) toastError("Couldn't run the slash command", result.error);
					});
					return;
				case "unavailable":
					toast.error(action.message);
					return;
			}
		},
		[actions, runCommand, sessionId, startTerminalCommand],
	);

	const finishTerminalCommand = useCallback(() => {
		setTerminalRun(null);
		void actions.sessions.restartAgent(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't restart the agent", result.error);
		});
	}, [actions, sessionId]);

	const extensions = useMemo(
		() =>
			buildComposerExtensions({
				files: {
					search: () => [
						...linkedPaths.current.map((path) => ({ path, isDirectory: true })),
						...files.current,
					],
					onOpen: () => void loadFiles(),
					actions: [
						{
							id: "terminal-output",
							label: "Attach current terminal output",
							onChoose: () => void attachTerminalOutput(),
						},
						{
							id: "working-directories",
							label: "Select working directories",
							onChoose: () => setLinkDialogOpen(true),
						},
					],
				},
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
					get listState() {
						return slashListState.current;
					},
					onRun: runSlashCommand,
				},
			}),
		[attachTerminalOutput, loadFiles, runSlashCommand],
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

	// Cmd+I and the palette's "Link issue" open or close the dialog. Only the chat on screen takes
	// it, so a second chat beside it in a split pane does not open its own.
	useCommandHandler("chat.linkIssue", "area", () => {
		if (services.sessions.store.getState().viewingSessionId !== sessionId) return false;
		setIssueDialogOpen((open) => !open);
		return true;
	});

	const addLinkedIssue = useCallback((path: string) => {
		setAttachments((current) => (current.includes(path) ? current : [...current, path]));
	}, []);

	const focusEditorAtEnd = useCallback(() => {
		editorRef.current?.commands.focus("end");
	}, []);

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
		<div className="flex flex-col gap-2">
			<FastModeUnavailableBanner
				sessionId={sessionId}
				fastModeRequested={session?.config.fastMode === true}
				fastModeAvailable={live?.fastModeAvailable ?? true}
			/>
			<div
				ref={containerRef}
				className="rounded-xl border border-border bg-surface shadow-xs"
				data-narrow={narrow ? "true" : "false"}
			>
				{terminalRun === null ? null : (
					<div className="px-2 pt-2">
						<TerminalCommandStatus
							workspaceId={workspaceId}
							run={terminalRun}
							onReopen={() => void startTerminalCommand(terminalRun.command)}
							onDone={finishTerminalCommand}
						/>
					</div>
				)}
				<div className="flex items-center gap-1 px-2 pt-2">
					<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
						<PlusMenu
							sessionId={sessionId}
							onAddAttachment={() => void attachmentsController.pick()}
							onLinkIssue={() => setIssueDialogOpen(true)}
							onLinkWorkspaces={() => setLinkDialogOpen(true)}
						/>
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
				<AttachmentBar
					sessionId={sessionId}
					attachmentPaths={attachments}
					busy={attachmentsController.busy}
					onRemove={(path) => void attachmentsController.remove(path)}
				/>
				<ComposerEditor
					sessionId={sessionId}
					disabled={busy}
					onSubmit={(intent) => void send(intent)}
					sendWith={sendWith}
					onEditorReady={setEditor}
					extensions={extensions}
				/>
				<LinkDirectoriesDialog
					open={linkDialogOpen}
					onOpenChange={setLinkDialogOpen}
					workspaceId={workspaceId}
				/>
				<LinkIssueDialog
					open={issueDialogOpen}
					onOpenChange={setIssueDialogOpen}
					workspaceId={workspaceId}
					sessionId={sessionId}
					onAttached={addLinkedIssue}
					onFocusEditor={focusEditorAtEnd}
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
		</div>
	);
}
