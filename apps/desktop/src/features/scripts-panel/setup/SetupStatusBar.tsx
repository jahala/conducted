/**
 * @feature WS-03 Setup status bar
 * Owns: the line above the setup output. A state icon, the text for the state, and the primary
 * action (Stop, Run again, Ask agent to fix).
 * Behaviour: ui-map.md 3.7, "Setup" paragraph (state texts: running, failed, cancelled, detecting,
 * stopping).
 * Must handle: an exit code shown for failures, an interrupted-by-quit note, the action disabled
 * while a request is in flight, and a long reason text (two lines, expandable).
 * Test first: kind "running" shows a Stop action and kind "completed" shows Run again.
 */
import type { ReactNode } from "react";
import { Button } from "../../../ui/Button.tsx";
import { CheckCircleIcon, ClockIcon, DotIcon, XCircleIcon } from "../../../ui/icons.tsx";
import { SETUP_TAB_TEXT, type SetupTabKind, setupTabActions } from "./setup-state.ts";

export interface SetupStatusBarProps {
	kind: SetupTabKind;
	exitCode: number | null;
	interruptedReason: string | null;
	busy: boolean;
	onStop: () => void;
	onRunAgain: () => void;
	onAskAgentToFix: () => void;
}

function stateIcon(kind: SetupTabKind): ReactNode {
	if (kind === "failed") return <XCircleIcon className="text-danger" />;
	if (kind === "completed") return <CheckCircleIcon className="text-success" />;
	if (kind === "running" || kind === "detecting" || kind === "stopping") {
		return <ClockIcon className="text-status-progress" />;
	}
	return <DotIcon className="text-fg-subtle" />;
}

export function SetupStatusBar({
	kind,
	exitCode,
	interruptedReason,
	busy,
	onStop,
	onRunAgain,
	onAskAgentToFix,
}: SetupStatusBarProps) {
	const text = SETUP_TAB_TEXT[kind];
	const actions = setupTabActions(kind);
	const showExitCode = kind === "failed" && exitCode !== null;

	return (
		<div
			data-setup-status={kind}
			className="flex items-start gap-2 border-b border-border px-3 py-2"
		>
			<span className="mt-0.5 shrink-0">{stateIcon(kind)}</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-fg">{text.title}</p>
				{showExitCode ? <p className="text-xs text-fg-muted">Exit code {exitCode}</p> : null}
				{interruptedReason !== null ? (
					<p className="line-clamp-2 text-xs text-fg-muted">{interruptedReason}</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{actions.stop ? (
					<Button variant="outline" size="xs" disabled={busy} onClick={onStop}>
						Stop
					</Button>
				) : null}
				{actions.askAgentToFix ? (
					<Button variant="outline" size="xs" disabled={busy} onClick={onAskAgentToFix}>
						Ask agent to fix
					</Button>
				) : null}
				{actions.runAgain ? (
					<Button variant="default" size="xs" disabled={busy} onClick={onRunAgain}>
						Run again
					</Button>
				) : null}
			</div>
		</div>
	);
}
