/**
 * @feature COMP-01 Composer
 * Owns: The message box at the bottom of a chat: editor, toolbar (plus menu, model picker, mode
 * chips, ACP options, the Remote Control chip (RC-02), context wheel, MCP status) and the send or stop
 * button.
 * Behaviour: ui-map.md 3.5 (Composer: TipTap editor, placeholder, toolbar, send or queue button,
 * stop button), 3.4 (send button icon and tooltip switch between 'Send message', 'Queue message'
 * and 'Save edit').
 * Measured from Conductor 0.92.1 (renderApp @9314800): a 12px-radius box in the muted fill with a 1px
 * border, at least 152px tall, padded 16px top and right, 12px bottom, 18px left; the editor first, with
 * 40px kept free under it; one bottom row: the model picker and mode controls 7px from the left and 12px
 * from the bottom, and 12px from the right the MCP status, the context ring, "+", then stop and send,
 * 6px apart in a 28px row; a "⌘L to focus" pill at the top right while the editor is not focused.
 * Our design choice: Narrow composers (under 480px measured) move toolbar items into one 'More
 * composer actions' menu; wide ones show the MCP status button directly. The ACP options are ours
 * and sit after the model picker. Remote Control (RC-02, ours) is a "+" item and, while on, a chip
 * after the mode chips, as Conductor shows "Auto-accept edits" (D098).
 * While a tool approval waits, the approval card (CHAT-11) takes the place of the text box and its
 * rows, which stay mounted and hidden, as Conductor draws it (renderApp @9315874; D098).
 * While a plan waits for review, the placeholder reads Conductor's "Enter your plan adjustments
 * here..." and sending answers the plan as not approved with the text as its feedback (CHAT-12,
 * renderApp @9294541, @9299794; D098). Cmd+Shift+Enter ("Approve plan") and the plan bar's Approve
 * send that text the same way, and with no text the bar approves (renderApp @9313268). The key acts
 * only while plan mode is on, as Conductor's does (renderApp @9295497).
 * Keyboard: Cmd+L focuses the editor and Cmd+Shift+Backspace cancels the running agent. Both are
 * command handlers (NAV-14), so a shortcut the user rebinds moves with it.
 * Must handle: agent working (send becomes queue or steer, a stop button appears); draft restored
 * when the app restarts; empty text (send disabled); attachments only (send enabled); the sidecar is
 * down (message kept, error shown, nothing lost); a draft write or clear that fails (error shown);
 * focus returns to the editor after sending; Cmd+L focuses the editor; the file list fails to load
 * (error shown) or an older list arrives after a newer one (dropped); a terminal for a slash
 * command that cannot be created (shown on the bar, with Reopen terminal).
 * The editor loads the `@` trigger (COMP-04), the `#` trigger (COMP-05), the `/` trigger
 * (COMP-06) and the `§` snippet trigger (COMP-09) from this composer, so all read the chat's
 * service. The `@` menu lists the workspace's files and its linked folders, read again each time
 * the menu opens, and offers "Attach current terminal output" and "Select working directories"
 * (WS-07). The `#` menu lists the project's pull requests and issues
 * (core/services/mention-search.ts), writes the chosen item's context file and inserts a chip; a
 * failed write shows "Failed to save PR context". A slash command the user picks does what
 * `slashCommandAction` says: /clear opens a new
 * chat tab (the tab strip's own Cmd+T handler) and closes this one, /restart restarts the agent,
 * /compact asks a Codex chat to summarise its history, /add-dir opens the Link workspaces and
 * directories dialog (WS-07), /plan and /fast run the plan and fast mode toggles of the toolbar,
 * a command the agent lists is sent to it, and any other says it is not available. A
 * terminal-effect command opens a terminal that runs it and shows the terminal command bar above
 * the composer; the bar follows
 * that terminal (closed, finished, failed); Done
 * restarts the agent, forgets the chat's cached MCP list (SET-05) and says "Configuration
 * refreshed." (ui-map.md 3.5). Attachments are added from the '+' menu, a drop or
 * a paste by the COMP-07 hook, shown in AttachmentBar, and materialised when the message is sent.
 * The '+' menu's "Link issue", Cmd+I and the palette's "Link issue" open the Link issue dialog
 * (PR-09) of the chat on screen; the issue it links joins the same attachment list.
 * /goal in a Codex chat puts the composer in goal mode (COMP-10, as Conductor does): the empty
 * editor says "Set a goal", and sending sets the text as the chat's goal through
 * `actions.sessions.goal.set` instead of sending it as a message. A goal takes no attachments, so
 * the send clears only the text and keeps them for the next message. Goal mode ends after the send
 * and when the chat changes. The Codex goal bar itself is GoalBar, above the composer.
 * Moved: 'Save edit' belongs to the queued-message editor (CHAT-04); the composer minimising while
 * a content tab is open belongs to the tab strip (NAV-10); the new-workspace form reusing this
 * editor belongs to workspace creation (WS-01). The archived bar (ArchivedComposerBar) is not
 * rendered here: ChatPane shows it in this component's place when the workspace is archived.
 * The toolbar also holds the dictation button (COMP-08), after "+" and before send as in Conductor's
 * right cluster (renderApp @9319162); it inserts its transcript at the caret.
 * Test first: With text typed and the agent idle, the send button is enabled; while the agent works
 * it reads 'Queue message' and a Cancel button shows.
 */

import type { SlashCommand } from "@conducted/protocol";
import type {
	AppError,
	InteractionId,
	SessionId,
	TerminalId,
	WorkspaceId,
} from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler, useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useLiveShortcut,
	usePrMentionQueries,
	useSlashCommands,
	useWorkspace,
} from "../../core/hooks.ts";
import type { PrMentionItem } from "../../core/mention-search.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { BlocksIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { ContextWheel } from "../chat/ContextWheel.tsx";
import { InteractionHost } from "../chat/interactions/InteractionHost.tsx";
import { RemoteControlButton } from "../chat/RemoteControlButton.tsx";
import { AcpOptions } from "./AcpOptions.tsx";
import { AttachmentBar } from "./AttachmentBar.tsx";
import { ComposerEditor } from "./ComposerEditor.tsx";
import { buildComposerExtensions } from "./composer-extensions.ts";
import { DictationButton } from "./DictationButton.tsx";
import { FastModeUnavailableBanner } from "./FastModeUnavailableBanner.tsx";
import { toastGoalError } from "./GoalBar.tsx";
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
import { createSnippetMention } from "./mentions/SnippetMention.ts";
import { PlusMenu } from "./PlusMenu.tsx";
import { type PlanAdjustmentsOutcome, useProvidePlanAdjustments } from "./plan-adjustments.tsx";
import { SendButton, type SendButtonState } from "./SendButton.tsx";
import { openSnippetPicker } from "./SnippetOverlays.tsx";
import type { SendIntent, SendWith } from "./send-key.ts";
import { useSnippetDialogsStore } from "./snippet-dialogs-store.ts";
import { TerminalCommandBar } from "./TerminalCommandBar.tsx";
import { inlineTextContent } from "./text-content.ts";
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
	const prMentions = usePrMentionQueries();
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
	const [focused, setFocused] = useState(false);
	const focusShortcut = useLiveShortcut("chat.focusInput");
	const [busy, setBusy] = useState(false);
	const [linkDialogOpen, setLinkDialogOpen] = useState(false);
	const [issueDialogOpen, setIssueDialogOpen] = useState(false);
	const [goalMode, setGoalMode] = useState(false);
	const attachmentsController = useAttachments({
		sessionId,
		editor,
		attachmentPaths: attachments,
		onPathsChange: setAttachments,
	});
	const live = useStore(services.sessions.store, (state) => state.liveStates[sessionId]);
	const draftError = useStore(services.composer.store, (state) => state.errors[sessionId]);
	const snippets = useStore(services.composer.store, (state) => state.snippets);
	const snippetError = useStore(services.composer.store, (state) => state.snippetError);
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
	// While the agent waits on a plan, the composer takes the user's adjustments (CHAT-12).
	const planInteractionId = useStore(services.sessions.store, (state) => {
		const open = state.openInteractions[sessionId];
		return open !== undefined && open.interaction.kind === "plan_approval" && !open.timedOut
			? open.interactionId
			: null;
	});
	// A tool approval takes the place of the text box, as Conductor draws it (CHAT-11, D098).
	const approval = useStore(services.sessions.store, (state) => {
		const open = state.openInteractions[sessionId];
		return open !== undefined && open.interaction.kind === "tool_approval" ? open : null;
	});
	const empty = text.trim().length === 0;
	const textOnly = goalMode || planInteractionId !== null;
	const disabled = busy || (textOnly ? empty : empty && attachments.length === 0);

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

	const searchMentionRows = useCallback(
		(query: string) => prMentions.search(workspaceId, query),
		[prMentions, workspaceId],
	);

	const attachMentionRow = useCallback(
		(item: PrMentionItem) => prMentions.attach(workspaceId, item),
		[prMentions, workspaceId],
	);

	const reportPrMentionError = useCallback((error: AppError) => {
		toastError("Failed to save PR context", error);
	}, []);

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
					// The clear action starts a replacement chat, shows it and stops the old agent.
					void actions.sessions.clear(sessionId).then((result) => {
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
				case "goal":
					setGoalMode(true);
					editorRef.current?.commands.focus();
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
		void (async () => {
			const restarted = await actions.sessions.restartAgent(sessionId);
			if (!restarted.ok) {
				toastError("Couldn't restart the agent", restarted.error);
				return;
			}
			// The command may have edited the agent's own files (/mcp adds or removes a server), so
			// the chat's cached MCP list is out of date until the next look reads the config again.
			// Conductor clears its list and has no wording of its own for a failure, so the error's
			// own message is shown, as Conductor does for its other command-bar errors.
			const forgotten = await actions.mcp.forget(sessionId);
			if (!forgotten.ok) {
				toast.error(forgotten.error.message);
				return;
			}
			toast.success("Configuration refreshed.");
		})();
	}, [actions, sessionId]);

	const extensions = useMemo(
		() => [
			...buildComposerExtensions({
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
				pullRequests: {
					search: searchMentionRows,
					attach: attachMentionRow,
					onError: reportPrMentionError,
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
			createSnippetMention({
				snippets: () => services.composer.store.getState().snippets,
				error: () => services.composer.store.getState().snippetError?.message ?? null,
				onOpen: () => void services.composer.loadSnippets(),
			}),
		],
		[
			attachMentionRow,
			attachTerminalOutput,
			loadFiles,
			reportPrMentionError,
			runSlashCommand,
			searchMentionRows,
			services,
		],
	);

	const restore = useCallback((draft: Draft) => {
		setAttachments([...draft.attachmentPaths]);
		setText(draft.text);
	}, []);

	useDraftSync({
		sessionId,
		editor,
		attachmentPaths: attachments,
		onRestore: restore,
		onStoredAttachments: setAttachments,
	});

	// Goal mode belongs to the chat it was chosen in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the reset runs when the chat changes
	useEffect(() => {
		setGoalMode(false);
	}, [sessionId]);

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

	// A snippet list that arrives after the trigger opened redraws that menu.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the list change must redraw the open trigger
	useEffect(() => {
		if (editor === null) return;
		editor.view.dispatch(editor.state.tr);
	}, [editor, snippetError, snippets]);

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
		// A dialog's close focus can land after the composer itself has gone.
		const editor = editorRef.current;
		if (editor === null || editor.isDestroyed) return;
		editor.commands.focus("end");
	}, []);

	// Dictation (COMP-08) and snippets (COMP-09) both put text at the cursor, as plain text with
	// its line breaks (a string would be read as HTML).
	const insertText = useCallback((text: string) => {
		editorRef.current?.chain().focus().insertContent(inlineTextContent(text)).run();
	}, []);
	useCommandHandler("chat.insertSnippet", "area", () => {
		if (services.sessions.store.getState().viewingSessionId !== sessionId) return false;
		openSnippetPicker(insertText);
		return true;
	});

	useCommandHandler("chat.cancelAgent", "area", () => {
		if (!working) return false;
		void stop();
		return true;
	});

	const clearEditor = async (current: Editor) => {
		current.commands.setContent("", { emitUpdate: false });
		setText("");
		setAttachments([]);
		const cleared = await services.composer.clearDraft(sessionId);
		if (!cleared.ok) toastError("Couldn't clear the draft", cleared.error);
		current.commands.focus();
	};

	const saveGoal = async (current: Editor) => {
		setBusy(true);
		try {
			const result = await actions.sessions.goal.set(sessionId, current.getText());
			if (!result.ok) {
				toastGoalError(result.error);
				return;
			}
			setGoalMode(false);
			// A goal takes only the text. The update event saves the draft with its attachments
			// kept, so files the user added stay for the next message.
			current.commands.setContent("", { emitUpdate: true });
			setText("");
			current.commands.focus();
		} finally {
			setBusy(false);
		}
	};

	/**
	 * Conductor's plan feedback: text sent while a plan waits answers it as not approved, with the
	 * text as the adjustments (renderApp @9299794). Attachments stay in the draft for the next message.
	 */
	const sendPlanFeedback = async (current: Editor, interactionId: InteractionId) => {
		const feedback = current.getText().trim();
		if (feedback.length === 0) return;
		setBusy(true);
		try {
			const result = await actions.sessions.answer(sessionId, interactionId, {
				kind: "plan_approval",
				approved: false,
				feedback,
			});
			if (!result.ok) {
				toastError("Couldn't send the plan adjustments", result.error);
				return;
			}
			current.commands.setContent("", { emitUpdate: true });
			setText("");
			current.commands.focus();
		} finally {
			setBusy(false);
		}
	};

	const send = async (intent: SendIntent) => {
		if (editor === null) return;
		if (goalMode) {
			await saveGoal(editor);
			return;
		}
		if (planInteractionId !== null) {
			await sendPlanFeedback(editor, planInteractionId);
			return;
		}
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
			await clearEditor(editor);
		} finally {
			setBusy(false);
		}
	};

	// Conductor's approve action, from its button or its shortcut, sends the composer's text as the
	// plan's adjustments when there is any (renderApp @9313268). The plan bar asks here first.
	const sendAdjustments = (): PlanAdjustmentsOutcome => {
		if (planInteractionId === null || editor === null) return "none";
		// Adjustments already on their way: approving under them would answer the plan twice.
		if (busy) return "busy";
		if (editor.getText().trim().length === 0) return "none";
		void sendPlanFeedback(editor, planInteractionId);
		return "sent";
	};
	useProvidePlanAdjustments(sendAdjustments);

	// Cmd+Shift+Enter while a plan waits (CHAT-12). It acts only in plan mode, as Conductor's does
	// (renderApp @9295497). An empty composer passes the key on to the plan bar, which approves. Only
	// the chat on screen takes it.
	useCommandHandler("chat.approvePlan", "area", () => {
		if (services.sessions.store.getState().viewingSessionId !== sessionId) return false;
		if (session?.config.planMode !== true) return false;
		return sendAdjustments() !== "none";
	});

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
				className="relative min-h-[var(--composer-min-height)] cursor-text rounded-xl border border-border bg-muted pt-4 pr-4 pb-3 pl-[18px] shadow-xs"
				data-narrow={narrow ? "true" : "false"}
			>
				{approval === null ? null : (
					<InteractionHost
						key={approval.interactionId}
						sessionId={sessionId}
						interactionId={approval.interactionId}
						interaction={approval.interaction}
						expiresAt={approval.expiresAt}
						timedOut={approval.timedOut}
					/>
				)}
				{/* The text box and its rows stay mounted under an approval, so the draft and the
				    editor's state survive it. */}
				<div
					className={approval === null ? "contents" : "hidden"}
					aria-hidden={approval === null ? undefined : true}
				>
					{terminalRun === null ? null : (
						<div className="pb-2">
							<TerminalCommandStatus
								workspaceId={workspaceId}
								run={terminalRun}
								onReopen={() => void startTerminalCommand(terminalRun.command)}
								onDone={finishTerminalCommand}
							/>
						</div>
					)}
					<AttachmentBar
						sessionId={sessionId}
						attachmentPaths={attachments}
						busy={attachmentsController.busy}
						onRemove={(path) => void attachmentsController.remove(path)}
					/>
					<div className="mb-10">
						<ComposerEditor
							sessionId={sessionId}
							disabled={busy}
							onSubmit={(intent) => void send(intent)}
							sendWith={sendWith}
							onEditorReady={setEditor}
							extensions={extensions}
							onFocusChange={setFocused}
							{...(goalMode
								? { placeholder: "Set a goal" }
								: planInteractionId !== null
									? { placeholder: "Enter your plan adjustments here..." }
									: {})}
						/>
					</div>
					{focused || focusShortcut === null ? null : (
						<div className="pointer-events-none absolute top-2 right-1 rounded-full bg-muted px-2 py-1 text-xs text-fg-subtle">
							{focusShortcut} to focus
						</div>
					)}
					<div className="absolute bottom-3 left-[7px] flex min-w-0 items-center gap-0.5 overflow-hidden">
						<NotBuiltYet area="Model" variant="inline" resetKey={sessionId}>
							<ModelPicker sessionId={sessionId} />
						</NotBuiltYet>
						<NotBuiltYet area="Modes" variant="inline" resetKey={sessionId}>
							<ModeChips sessionId={sessionId} />
						</NotBuiltYet>
						<RemoteControlButton sessionId={sessionId} />
						<AcpOptions sessionId={sessionId} />
					</div>
					<div className="absolute right-3 bottom-3 flex h-7 shrink-0 items-center gap-1.5">
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
							<IconButton
								size="xs"
								label="MCP status"
								icon={<BlocksIcon className="size-3.5" />}
								className="text-fg-muted"
								onClick={checkMcp}
							/>
						)}
						<ContextWheel sessionId={sessionId} />
						<PlusMenu
							sessionId={sessionId}
							onAddAttachment={() => void attachmentsController.pick()}
							onLinkIssue={() => setIssueDialogOpen(true)}
							onLinkWorkspaces={() => setLinkDialogOpen(true)}
							onAddSnippet={() => useSnippetDialogsStore.getState().openCreate()}
							onInsertSnippet={() => openSnippetPicker(insertText)}
						/>
						{/* Conductor puts speech to text after the "+" menu, just before send. */}
						<DictationButton onTranscript={insertText} />
						<SendButton
							state={buttonState}
							disabled={disabled}
							busy={busy}
							working={working}
							hasContent={text.trim().length > 0 || attachments.length > 0}
							sendWith={sendWith}
							onSend={() => void send("submit")}
							onStop={() => void stop()}
						/>
					</div>
				</div>
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
			</div>
		</div>
	);
}
