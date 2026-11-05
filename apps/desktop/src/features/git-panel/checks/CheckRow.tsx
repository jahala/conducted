/**
 * @feature PR-04 Check row with log
 * Owns: one check. A state icon, the name, how long it ran, and an expandable log.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph ("Running, Failed, Cancelled, Pending, Waiting with
 * logs"); services-map.md 3.7.5 ("Failed job log": the last 1000 lines are kept).
 * Data: the log loads when the row first expands, through the useCheckLog hook. The loaded log
 * stays mounted while the row is collapsed, so opening it again shows the same text.
 * Must handle: a log that is still loading, one that fails to load ("Couldn't load the logs"),
 * one that expired or was never recorded, a check that has no job (external status), ANSI escape
 * codes in the log, and the log being copyable.
 * Test first: expanding a failed check requests its log once, and collapsing and expanding again
 * does not request it twice.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useActions, useCheckLog } from "../../../core/hooks.ts";
import type { CheckRun, CheckState } from "../../../core/model.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import {
	CheckCircleIcon,
	CircleIcon,
	ClockIcon,
	GlobeIcon,
	XCircleIcon,
} from "../../../ui/icons.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { CheckLogView } from "./CheckLogView.tsx";

export interface CheckRowProps {
	workspaceId: WorkspaceId;
	check: CheckRun;
	expanded: boolean;
	onToggle: () => void;
	onOpenUrl?: (url: string) => void;
}

const STATE_LABEL: Readonly<Record<CheckState, string>> = {
	pending: "Pending",
	waiting: "Waiting",
	running: "Running",
	success: "Passed",
	failure: "Failed",
	cancelled: "Cancelled",
	skipped: "Skipped",
};

export function checkStateLabel(state: CheckState): string {
	return STATE_LABEL[state];
}

/** How long a finished check ran, in a short human form. Empty while it has not finished. */
export function checkDuration(check: CheckRun): string {
	if (check.startedAt === null || check.completedAt === null) return "";
	const totalSeconds = Math.max(0, Math.round((check.completedAt - check.startedAt) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

function StateMark({ state }: { state: CheckState }) {
	if (state === "running") return <Spinner label="Running" size="sm" />;
	if (state === "success") {
		return <CheckCircleIcon className="size-4 text-success" aria-label="Passed" />;
	}
	if (state === "failure") {
		return <XCircleIcon className="size-4 text-danger" aria-label="Failed" />;
	}
	if (state === "pending" || state === "waiting") {
		return <ClockIcon className="size-4 text-warning" aria-label={STATE_LABEL[state]} />;
	}
	return <CircleIcon className="size-4 text-fg-subtle" aria-label={STATE_LABEL[state]} />;
}

function CheckLogLoader({ workspaceId, check }: { workspaceId: WorkspaceId; check: CheckRun }) {
	const log = useCheckLog(workspaceId, check.name);
	const actions = useActions();
	const queryClient = useQueryClient();
	const retry = () => {
		void queryClient.invalidateQueries({
			queryKey: ["github", "check-log", workspaceId, check.name],
		});
	};
	return <CheckLogView log={log} onRetry={retry} onCopy={(text) => actions.app.copyText(text)} />;
}

export function CheckRow({ workspaceId, check, expanded, onToggle, onOpenUrl }: CheckRowProps) {
	// The log mounts on the first expansion and stays mounted afterwards, so a collapse and a reopen
	// reuse it instead of asking GitHub again.
	const [hasOpened, setHasOpened] = useState(expanded);
	useEffect(() => {
		if (expanded) setHasOpened(true);
	}, [expanded]);

	const duration = checkDuration(check);
	const url = check.url;

	return (
		<div data-testid="check-row" className="border-b border-separator last:border-b-0">
			<div className="flex items-center gap-1 pr-2">
				<button
					type="button"
					aria-expanded={expanded}
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left hover:bg-hover"
				>
					<StateMark state={check.state} />
					<span className="min-w-0 flex-1 truncate text-sm text-fg">{check.name}</span>
					{duration.length === 0 ? null : (
						<span className="shrink-0 text-xs text-fg-subtle">{duration}</span>
					)}
					<span className="shrink-0 text-xs text-fg-muted">{checkStateLabel(check.state)}</span>
				</button>
				{url === null || onOpenUrl === undefined ? null : (
					<IconButton
						label={`Open ${check.name} on GitHub`}
						icon={<GlobeIcon />}
						size="sm"
						onClick={() => onOpenUrl(url)}
					/>
				)}
			</div>
			{hasOpened ? (
				<div hidden={!expanded}>
					<CheckLogLoader workspaceId={workspaceId} check={check} />
				</div>
			) : null}
		</div>
	);
}
