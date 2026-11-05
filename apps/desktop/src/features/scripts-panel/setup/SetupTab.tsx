/**
 * @feature WS-03 Setup tab
 * Owns: the Setup tab body. The status line, the live or saved output, and the actions for each
 * state.
 * Behaviour: ui-map.md 3.7, "Setup" paragraph (running, failed with a "fix it" prompt sent to the
 * chat, cancelled, detecting, stopping, empty, and logs that could not be loaded); services-map.md
 * 5A.1.2 (SetupProcessStore).
 * Data: useSetupState (shaped by setup-state.ts), useWorkspace, useSessions, useActions().
 * Children: SetupStatusBar, SetupEmptyState, terminal/TerminalView for live output.
 * Must handle: every SetupTabKind in setup-state.ts, Stop while running, "Run setup again" after a
 * failure, the fix action sending the failure log to the chat, a log that fails to load ("Couldn't
 * load the logs", with Retry), and an archived workspace.
 * Our design choice: "Add manually" opens the repository pages of Settings, because the per-repo
 * Scripts page has no route of its own yet.
 * Test first: kind "failed" shows the failure log and a fix action that calls the chat action once.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useSessions, useSetupState, useWorkspace } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { TerminalView } from "../../terminal/TerminalView.tsx";
import { SetupEmptyState } from "./SetupEmptyState.tsx";
import { SetupStatusBar } from "./SetupStatusBar.tsx";
import { SETUP_TAB_TEXT, setupTabKind } from "./setup-state.ts";

/** Sent to the chat when the user asks the agent to fix a failed setup. */
export const SETUP_FIX_PROMPT =
	"The setup script failed. Read the setup log in the Setup tab and fix the problem.";

/** Sent to the chat when the user asks the agent to add a setup script. */
export const ADD_SETUP_PROMPT =
	"Add a setup script for this repository that installs dependencies and prepares the environment when a workspace is created.";

export interface SetupTabProps {
	workspaceId: WorkspaceId;
}

export function SetupTab({ workspaceId }: SetupTabProps) {
	const setup = useSetupState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const actions = useActions();
	const navigate = useNavigate();
	const services = useServices();
	const [busy, setBusy] = useState(false);
	const [logText, setLogText] = useState<string | null | undefined>(undefined);
	const savedLog = setup.state === "ready" ? setup.data.log : null;
	const savedTerminal = setup.state === "ready" ? setup.data.terminalId : null;

	useEffect(() => {
		let active = true;
		if (savedLog !== "saved" || savedTerminal !== null) {
			setLogText(undefined);
			return () => {
				active = false;
			};
		}
		void services.services.workspace.readSetupLog(workspaceId).then((result) => {
			if (active) setLogText(result.ok ? result.value : null);
		});
		return () => {
			active = false;
		};
	}, [services, workspaceId, savedLog, savedTerminal]);

	if (setup.state === "loading" || workspace.state === "loading" || sessions.state === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading setup" />
			</div>
		);
	}
	if (setup.state === "error") {
		return <EmptyState title="Setup is unavailable" body={setup.error.message} tone="failed" />;
	}
	if (workspace.state === "error") {
		return <EmptyState title="Setup is unavailable" body={workspace.error.message} tone="failed" />;
	}
	if (sessions.state === "error") {
		return <EmptyState title="Setup is unavailable" body={sessions.error.message} tone="failed" />;
	}

	const view = setup.data;
	const workspaceRow = workspace.data;
	const kind = setupTabKind(view);
	const text = SETUP_TAB_TEXT[kind];
	const terminalId: TerminalId | null = view.terminalId;
	const archived = workspaceRow.state === "archived" || workspaceRow.state === "archiving";
	const activeSession =
		workspaceRow.activeSessionId === null
			? sessions.data[0]
			: (sessions.data.find((session) => session.id === workspaceRow.activeSessionId) ??
				sessions.data[0]);
	const canSendToChat = !archived && activeSession !== undefined;

	const run = async (work: () => Promise<unknown>): Promise<void> => {
		setBusy(true);
		try {
			await work();
		} finally {
			setBusy(false);
		}
	};

	const send = (prompt: string): void => {
		if (activeSession === undefined) return;
		void run(() => actions.sessions.send(activeSession.id, prompt, [], "auto"));
	};

	const showStatus = kind !== "no_script" && kind !== "not_run" && kind !== "log_missing";
	const showOutput = showStatus && terminalId !== null;

	return (
		<div className="flex h-full min-h-0 flex-col">
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
					busy={busy || archived || (kind === "failed" && !canSendToChat)}
					onStop={() => {
						if (terminalId === null) return;
						void run(() => actions.terminals.close(terminalId));
					}}
					onRunAgain={() => void run(() => actions.workspaces.retrySetup(workspaceId))}
					onAskAgentToFix={() => send(SETUP_FIX_PROMPT)}
				/>
			) : null}

			{kind === "no_script" ? (
				<SetupEmptyState
					hasScript={false}
					canAskAgent={canSendToChat}
					onAskAgent={() => send(ADD_SETUP_PROMPT)}
					onAddManually={() => void navigate({ to: "/settings/$page", params: { page: "repos" } })}
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
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void run(() => actions.workspaces.retrySetup(workspaceId))}
						>
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
						logText === undefined ? (
							<Spinner label="Loading the setup log" />
						) : logText === null ? (
							<p className="text-sm text-fg-muted">
								{SETUP_TAB_TEXT.log_missing.body ?? "No logs were recorded, or they have expired."}
							</p>
						) : (
							<pre className="max-h-full w-full overflow-auto whitespace-pre-wrap text-left text-code text-fg-muted">
								{logText}
							</pre>
						)
					) : (
						<p className="text-sm text-fg-muted">
							{SETUP_TAB_TEXT.log_missing.body ?? "No setup output was recorded."}
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}
