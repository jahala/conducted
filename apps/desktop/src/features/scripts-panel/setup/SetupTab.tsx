/**
 * @feature WS-03 Setup tab
 * Owns: the Setup tab body. The status line, the live or saved output, and the actions for each
 * state.
 * Behaviour: ui-map.md 3.7, "Setup" paragraph (running, failed with a "fix it" prompt sent to the
 * chat, cancelled, detecting, stopping, empty, and logs that could not be loaded); services-map.md
 * 5A.1.2 (SetupProcessStore).
 * Data: useSetupState (shaped by setup-state.ts), useWorkspace, useSessions, useActions().
 * Children: SetupStatusBar, SetupEmptyState, terminal/TerminalView for live output.
 * Must handle: every SetupTabKind in setup-state.ts, settings that cannot be read ("Couldn't load
 * setup script settings"), "Ask agent" with no chat to send to (Conductor's toast), Stop while
 * running, "Run setup again" after a
 * failure (it needs no chat), the fix action sending the failure log to the chat, a saved log
 * that fails to load (the error's own message, with Retry), a Run again that fails for a reason
 * other than the script failing (that reason shows in the toast), a workspace whose initialization
 * failed (Retry and Delete, Conductor's recovery row), and an archived workspace.
 * Our design choice: "Add manually" opens the repository pages of Settings, because the per-repo
 * Scripts page has no route of its own yet.
 * Test first: kind "failed" shows the failure log and a fix action that calls the chat action once.
 */
import type { Result, SessionId, TerminalId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Actions } from "../../../core/api.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useSessions, useSetupState, useWorkspace } from "../../../core/hooks.ts";
import type { Session, SetupView, Workspace } from "../../../core/model.ts";
import type { WorkspaceService } from "../../../core/services/workspace.ts";
import { isArchivedWorkspace } from "../../../core/status/archived.ts";
import {
	SETUP_FAILED_MESSAGE,
	SETUP_LOG_MISSING_MESSAGE,
} from "../../../core/workspace-helpers.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { TerminalView } from "../../terminal/TerminalView.tsx";
import { deleteWorkspace } from "../../workspace/archive-workspace.tsx";
import { SetupEmptyState } from "./SetupEmptyState.tsx";
import { SetupStatusBar } from "./SetupStatusBar.tsx";
import { SETUP_TAB_TEXT, type SetupTabKind, setupTabKind } from "./setup-state.ts";

/** How many lines of the setup log the fix request carries. */
export const SETUP_LOG_TAIL_LINES = 200;

/** Sent to the chat when the user asks the agent to fix a failed setup. */
export const SETUP_FIX_PROMPT =
	"The setup script failed. Fix the problem it reported, then run setup again.";

/** Adds the end of the setup log to the fix request, so the agent does not need the app. */
export function setupFixPrompt(log: string | null): string {
	const text = log?.trim() ?? "";
	if (text === "") return SETUP_FIX_PROMPT;
	const tail = text.split("\n").slice(-SETUP_LOG_TAIL_LINES).join("\n");
	return `${SETUP_FIX_PROMPT}\n\nThe last lines of the setup log:\n\n\`\`\`\n${tail}\n\`\`\``;
}

/** Sent to the chat when the user asks the agent to add a setup script. */
export const ADD_SETUP_PROMPT =
	"Add a setup script for this repository that installs dependencies and prepares the environment when a workspace is created.";

/** The chat a setup request goes to: the workspace's active chat, else its first. */
export function setupRequestChat(
	workspace: Pick<Workspace, "activeSessionId">,
	sessions: readonly Session[],
): Session | undefined {
	return workspace.activeSessionId === null
		? sessions[0]
		: (sessions.find((session) => session.id === workspace.activeSessionId) ?? sessions[0]);
}

/**
 * Asks the agent to fix a failed setup: the fix request with the end of the saved log, sent to
 * `sessionId`. A log that cannot be read is said in a toast and the request goes without it.
 */
export async function requestSetupFix(
	actions: Pick<Actions, "sessions">,
	workspaceService: Pick<WorkspaceService, "readSetupLog">,
	input: { workspaceId: WorkspaceId; sessionId: SessionId; hasSavedLog: boolean },
): Promise<Result<unknown>> {
	let log: string | null = null;
	if (input.hasSavedLog) {
		const read = await workspaceService.readSetupLog(input.workspaceId);
		if (read.ok) log = read.value;
		else toastError("Failed to attach setup logs", read.error);
	}
	return actions.sessions.send(input.sessionId, setupFixPrompt(log), [], "auto");
}

export interface SetupTabProps {
	workspaceId: WorkspaceId;
}

/** What the output area says when there is no terminal and no saved log to show. */
function noOutputText(kind: SetupTabKind, log: SetupView["log"]): string {
	if (log === "expired") return SETUP_LOG_MISSING_MESSAGE;
	if (kind === "detecting") return SETUP_TAB_TEXT.detecting.body ?? NO_OUTPUT;
	return NO_OUTPUT;
}

const NO_OUTPUT = "No setup output was recorded.";

type SavedLog =
	| { kind: "loading" }
	| { kind: "text"; text: string }
	| { kind: "error"; error: { message: string } };

function SavedLogBody({ log, onRetry }: { log: SavedLog; onRetry: () => void }) {
	if (log.kind === "loading") return <Spinner label="Loading the setup log" />;
	if (log.kind === "error") {
		return (
			<div className="flex flex-col items-center gap-2">
				<p className="text-sm font-medium text-fg">{SETUP_TAB_TEXT.log_missing.title}</p>
				<p className="text-sm text-fg-muted">{log.error.message}</p>
				<Button variant="outline" size="sm" onClick={onRetry}>
					Retry
				</Button>
			</div>
		);
	}
	return (
		<pre className="max-h-full w-full overflow-auto whitespace-pre-wrap text-left text-code text-fg-muted">
			{log.text}
		</pre>
	);
}

export function SetupTab({ workspaceId }: SetupTabProps) {
	const setup = useSetupState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const actions = useActions();
	const navigate = useNavigate();
	const workspaceService = useServices().services.workspace;
	const [busy, setBusy] = useState(false);
	const [log, setLog] = useState<SavedLog>({ kind: "loading" });
	const [logAttempt, setLogAttempt] = useState(0);
	const savedLog = setup.state === "ready" ? setup.data.log : null;
	const savedTerminal = setup.state === "ready" ? setup.data.terminalId : null;

	// The cleanup flag drops an answer that arrives after the workspace or the log has changed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: logAttempt is the Retry trigger.
	useEffect(() => {
		let active = true;
		setLog({ kind: "loading" });
		if (savedLog !== "saved" || savedTerminal !== null) {
			return () => {
				active = false;
			};
		}
		void workspaceService.readSetupLog(workspaceId).then((result) => {
			if (!active) return;
			setLog(
				result.ok ? { kind: "text", text: result.value } : { kind: "error", error: result.error },
			);
		});
		return () => {
			active = false;
		};
	}, [workspaceService, workspaceId, savedLog, savedTerminal, logAttempt]);

	if (setup.state === "loading" || workspace.state === "loading" || sessions.state === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading setup" />
			</div>
		);
	}
	if (workspace.state === "error") {
		return <EmptyState title="Setup is unavailable" body={workspace.error.message} tone="failed" />;
	}
	if (setup.state === "error") {
		// The workspace loaded, so what failed is the repository's settings, where the script lives.
		return (
			<div className="flex h-full w-full items-center justify-center px-8 text-center">
				<p className="text-sm text-fg-muted">Couldn't load setup script settings</p>
			</div>
		);
	}
	if (sessions.state === "error") {
		return <EmptyState title="Setup is unavailable" body={sessions.error.message} tone="failed" />;
	}

	const view = setup.data;
	const workspaceRow = workspace.data;
	const kind = setupTabKind(view);
	const text = SETUP_TAB_TEXT[kind];
	const terminalId: TerminalId | null = view.terminalId;
	const archived = isArchivedWorkspace(workspaceRow) || workspaceRow.state === "archiving";
	const activeSession = setupRequestChat(workspaceRow, sessions.data);
	const canSendToChat = !archived && activeSession !== undefined;

	const run = async (
		work: () => Promise<Result<unknown>>,
		onFailure: (error: { code: string; message: string }) => void,
	): Promise<void> => {
		setBusy(true);
		try {
			const result = await work();
			if (!result.ok) onFailure(result.error);
		} finally {
			setBusy(false);
		}
	};

	const send = (prompt: string): void => {
		if (activeSession === undefined) {
			toast.error("No active chat to send setup request to");
			return;
		}
		const sessionId = activeSession.id;
		void run(
			() => actions.sessions.send(sessionId, prompt, [], "auto"),
			(error) => toastError("Failed to attach setup context", error),
		);
	};

	const runAgain = (): void => {
		void run(
			() => actions.workspaces.retrySetup(workspaceId),
			// The script failing has its own words. Any other reason (a missing workspace, a database
			// error) is shown as it is.
			(error) =>
				error.code === "setup_failed"
					? toast.error(SETUP_FAILED_MESSAGE)
					: toastError("Couldn't run setup again", error),
		);
	};

	const stop = (): void => {
		void run(
			() => workspaceService.cancelSetup(workspaceId),
			(error) => toastError("Couldn't stop the setup script", error),
		);
	};

	const removeWorkspace = (): void => {
		setBusy(true);
		void deleteWorkspace(actions, workspaceId).finally(() => setBusy(false));
	};

	const askAgentToFix = (): void => {
		if (activeSession === undefined) return;
		const sessionId = activeSession.id;
		void run(
			() =>
				requestSetupFix(actions, workspaceService, {
					workspaceId,
					sessionId,
					hasSavedLog: view.log === "saved",
				}),
			(error) => toastError("Failed to attach setup context", error),
		);
	};

	const showStatus = kind !== "no_script" && kind !== "not_run" && kind !== "log_missing";
	const showOutput = showStatus && terminalId !== null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{workspaceRow.state === "failed" && view.state !== "failed" ? (
				<div
					role="alert"
					className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-raised p-3"
				>
					<span className="text-sm text-danger">Workspace initialization failed</span>
					<Button type="button" size="sm" variant="outline" disabled={busy} onClick={runAgain}>
						Retry
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outlineDestructive"
						disabled={busy}
						onClick={removeWorkspace}
					>
						Delete
					</Button>
				</div>
			) : null}
			{showStatus && view.filesCopied !== null ? (
				<p className="px-3 pt-2 text-xs text-fg-subtle">
					{view.filesCopied} files in this workspace
				</p>
			) : null}

			{showStatus ? (
				<SetupStatusBar
					kind={kind}
					exitCode={view.exitCode}
					interruptedReason={view.interruptedReason}
					busy={busy || archived}
					canAskAgent={canSendToChat}
					onStop={stop}
					onRunAgain={runAgain}
					onAskAgentToFix={askAgentToFix}
				/>
			) : null}

			{kind === "no_script" ? (
				<SetupEmptyState
					hasScript={false}
					canAskAgent={!archived}
					onAskAgent={() => send(ADD_SETUP_PROMPT)}
					onAddManually={() =>
						void navigate({ to: "/settings/user/$page", params: { page: "repos" } })
					}
				/>
			) : null}

			{kind === "not_run" ? <EmptyState title={text.title} body={text.body ?? undefined} /> : null}

			{kind === "log_missing" ? (
				<>
					<EmptyState
						title={SETUP_TAB_TEXT.log_missing.title}
						body={SETUP_TAB_TEXT.log_missing.body ?? undefined}
					/>
					<div className="flex shrink-0 justify-center pb-3">
						<Button variant="outline" size="sm" disabled={busy} onClick={runAgain}>
							Retry
						</Button>
					</div>
				</>
			) : null}

			{showOutput ? (
				<div className="min-h-0 flex-1">
					<TerminalView terminalId={terminalId} workspaceId={workspaceId} visible />
				</div>
			) : null}

			{showStatus && !showOutput ? (
				<div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
					{view.log === "saved" ? (
						<SavedLogBody log={log} onRetry={() => setLogAttempt((attempt) => attempt + 1)} />
					) : (
						<p className="text-sm text-fg-muted">{noOutputText(kind, view.log)}</p>
					)}
				</div>
			) : null}
		</div>
	);
}
