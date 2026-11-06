/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: the Codex goal bar above the composer: the goal's status and objective, its token use
 * against a budget, Pause goal, Resume goal, Edit goal and Clear goal, and the edit field ('Goal',
 * Save goal, Cancel) that Edit goal opens.
 * Behaviour: ui-map.md 3.5 ("Codex goal bar: placeholder 'Goal', 'Save goal' (Cmd+Enter), 'Pause
 * goal', 'Resume goal', 'Edit goal', 'Clear goal'"), 5.4 (Cmd+Enter saves the goal). Conductor's
 * own bar shows nothing for a chat with no goal or a completed one; the status words ("Pursuing
 * goal", "Paused goal" and the rest), the "used / budget" count and Escape closing the field are
 * from its frontend bundle.
 * Data: the sessions store's `goals` (COMP-10), read on mount through `sessions.loadGoal`, and
 * `actions.sessions.goal`. The field is the `chat-goal` command scope, so Cmd+Enter reaches
 * `chat.saveGoal` and a rebind follows it.
 * Must handle: a chat that is not Codex (nothing is shown); no goal or a completed one (nothing is
 * shown); a goal read that fails (a toast, and nothing is shown); Save with empty text ("Enter a
 * goal first.", the field stays open); a save, pause, resume or clear the service refuses (its
 * message) or that fails ("Failed to update goal." with the reason); a second click while a change
 * is on its way (buttons are disabled).
 * Test first: Save with empty text shows "Enter a goal first."
 */
import type { CodexGoal } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import {
	CheckIcon,
	CloseIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	TargetIcon,
	XCircleIcon,
} from "../../ui/icons.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

const STATUS_LABEL: Readonly<Record<CodexGoal["status"], string>> = {
	active: "Pursuing goal",
	paused: "Paused goal",
	blocked: "Blocked goal",
	usage_limited: "Usage-limited goal",
	budget_limited: "Budget-limited goal",
	complete: "Completed goal",
};

const tokenCount = new Intl.NumberFormat("en-US");

/** "12,000 / 50,000" when the goal has a token budget. */
function tokenUse(goal: CodexGoal): string | null {
	if (goal.tokenBudget === undefined || goal.tokensUsed === undefined) return null;
	return `${tokenCount.format(goal.tokensUsed)} / ${tokenCount.format(goal.tokenBudget)}`;
}

/**
 * Shows a goal change that did not happen. The service's own refusals ("Enter a goal first.",
 * "Codex goals are not available in this chat.") are the whole message, as in Conductor.
 */
export function toastGoalError(error: AppError): void {
	if (error.code === "goal_empty" || error.code === "goal_unavailable") {
		toast.error(error.message);
		return;
	}
	toastError("Failed to update goal.", error);
}

export function GoalBar({ sessionId }: { sessionId: SessionId }) {
	const { services } = useServices();
	const actions = useActions();
	const agent = useStore(
		services.sessions.store,
		(state) => state.sessions[sessionId]?.config.agent,
	);
	const goal = useStore(services.sessions.store, (state) => state.goals?.[sessionId] ?? null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const field = useRef<HTMLTextAreaElement | null>(null);
	const codex = agent === "codex";

	useEffect(() => {
		if (!codex) return;
		void services.sessions.loadGoal(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't read the Codex goal", result.error);
		});
	}, [codex, services, sessionId]);

	// A chat switch closes the field, as Conductor's bar is a new one per chat.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the reset runs when the chat changes
	useEffect(() => {
		setEditing(false);
		setDraft("");
	}, [sessionId]);

	const run = (change: () => Promise<Result<void>>) => {
		setSaving(true);
		void change()
			.then((result) => {
				if (!result.ok) toastGoalError(result.error);
			})
			.finally(() => setSaving(false));
	};

	const save = () => {
		if (draft.trim().length === 0) {
			toast.error("Enter a goal first.");
			return;
		}
		setEditing(false);
		run(() => actions.sessions.goal.set(sessionId, draft));
	};

	useCommandHandler("chat.saveGoal", "area", () => {
		if (!editing || field.current === null || document.activeElement !== field.current) {
			return false;
		}
		save();
		return true;
	});

	if (!codex) return null;

	if (editing) {
		return (
			<div className="rounded-lg border border-border bg-surface p-2">
				<div className="flex items-start gap-2">
					<TargetIcon className="mt-1.5 shrink-0 text-fg-muted" />
					<textarea
						ref={field}
						data-command-scope="chat-goal"
						value={draft}
						placeholder="Goal"
						aria-label="Goal"
						disabled={saving}
						// biome-ignore lint/a11y/noAutofocus: Edit goal and /goal open the field to type in
						autoFocus
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Escape") return;
							event.preventDefault();
							setEditing(false);
						}}
						className="min-h-16 flex-1 resize-none rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent"
					/>
					<div className="flex shrink-0 items-center gap-1">
						<IconButton
							size="xs"
							label="Save goal"
							icon={<CheckIcon />}
							disabled={saving}
							onClick={save}
						/>
						<IconButton
							size="xs"
							label="Cancel"
							icon={<CloseIcon />}
							disabled={saving}
							onClick={() => setEditing(false)}
						/>
					</div>
				</div>
			</div>
		);
	}

	if (goal === null || goal.status === "complete") return null;
	const tokens = tokenUse(goal);
	return (
		<div className="flex min-h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
			<TargetIcon className="shrink-0 text-fg-muted" />
			<span className="min-w-0 flex-1 truncate text-fg">
				<span className="font-medium">{STATUS_LABEL[goal.status]}</span>{" "}
				<span className="text-fg-muted">{goal.objective}</span>
			</span>
			{tokens === null ? null : (
				<span className="shrink-0 text-xs tabular-nums text-fg-muted">{tokens}</span>
			)}
			<div className="flex shrink-0 items-center gap-0.5">
				{goal.status === "active" ? (
					<IconButton
						size="xs"
						label="Pause goal"
						icon={<PauseIcon />}
						disabled={saving}
						onClick={() => run(() => actions.sessions.goal.change(sessionId, "pause"))}
					/>
				) : null}
				{goal.status === "paused" ? (
					<IconButton
						size="xs"
						label="Resume goal"
						icon={<PlayIcon />}
						disabled={saving}
						onClick={() => run(() => actions.sessions.goal.change(sessionId, "resume"))}
					/>
				) : null}
				<IconButton
					size="xs"
					label="Edit goal"
					icon={<PencilIcon />}
					disabled={saving}
					onClick={() => {
						setDraft(goal.objective);
						setEditing(true);
					}}
				/>
				<IconButton
					size="xs"
					label="Clear goal"
					icon={<XCircleIcon />}
					disabled={saving}
					onClick={() => run(() => actions.sessions.goal.change(sessionId, "clear"))}
				/>
			</div>
		</div>
	);
}
