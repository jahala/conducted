/**
 * @feature CHAT-13 Progress tracker
 * Owns: The compact tracker above the composer, filled by the agent's UpdateProgress tool.
 * Behaviour: ui-map.md 3.3 (a title and blocks: bar, steps and text; the current step with "· 2/5"
 * and a status colour), claude-runner.md 4.2 (each call replaces the last; an empty block list
 * clears the tracker).
 * Data: the progress the sidecar sends for a chat, kept in SessionsService's store.
 * Our design choice: Conductor gates this behind an internal flag. Here it appears whenever the
 * agent sends an update; the sidecar offers the tool only when the chat's progressUpdates switch
 * is on.
 * Must handle: no progress (renders nothing); a steps block with no steps ("No tasks"); a failed
 * step (danger colour and the word "Failed"); every step done ("Done"); several bars; a new turn
 * clears the tracker.
 * Test first: steps [done, in_progress, pending] show the current step's label and "· 2/3".
 */

import type { ProgressBlock, ProgressStepStatus } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { withKeys } from "./tools/ToolCardFrame.tsx";

export interface ProgressTrackerProps {
	sessionId: SessionId;
}

type StepsBlock = Extract<ProgressBlock, { kind: "steps" }>;
type Step = StepsBlock["steps"][number];

const STEP_TONE: Record<ProgressStepStatus, string> = {
	pending: "text-fg-muted",
	in_progress: "text-info",
	done: "text-success",
	failed: "text-danger",
};

const STEP_DOT: Record<ProgressStepStatus, string> = {
	pending: "bg-border-strong",
	in_progress: "bg-info",
	done: "bg-success",
	failed: "bg-danger",
};

const STATUS_WORD: Partial<Record<ProgressStepStatus, string>> = {
	done: "Done",
	failed: "Failed",
};

function percentOf(value: number | undefined, max: number | undefined): number | null {
	if (value === undefined || max === undefined || max <= 0) return null;
	return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

/** The step to name: the one in progress, then a failed one, then the next pending. */
function currentIndexOf(steps: readonly Step[]): number {
	const inProgress = steps.findIndex((step) => step.status === "in_progress");
	if (inProgress !== -1) return inProgress;
	const failed = steps.findIndex((step) => step.status === "failed");
	if (failed !== -1) return failed;
	const pending = steps.findIndex((step) => step.status === "pending");
	if (pending !== -1) return pending;
	return steps.length - 1;
}

function BarBlock({ block }: { block: Extract<ProgressBlock, { kind: "bar" }> }) {
	const percent = percentOf(block.value, block.max);
	const known = percent !== null;
	return (
		<div>
			<div className="flex items-center justify-between gap-2 text-xs">
				<span className="min-w-0 break-words text-fg">{block.label}</span>
				{block.detail === undefined ? null : (
					<span className="shrink-0 text-fg-subtle">{block.detail}</span>
				)}
			</div>
			<div
				role="progressbar"
				aria-label={block.label}
				aria-valuemin={0}
				aria-valuemax={block.max}
				aria-valuenow={known ? block.value : undefined}
				className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
			>
				{known ? (
					<div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
				) : null}
			</div>
		</div>
	);
}

function StepsBlock({ block }: { block: StepsBlock }) {
	if (block.steps.length === 0) {
		return <p className="text-xs text-fg-subtle">No tasks</p>;
	}
	const index = currentIndexOf(block.steps);
	const current = block.steps[index];
	if (current === undefined) return null;
	const word = STATUS_WORD[current.status];
	return (
		<div className="flex items-center gap-2 text-xs">
			<ol aria-label="Progress steps" className="sr-only">
				{withKeys(block.steps, (step) => step.label, "step").map(({ key, item: step }) => (
					<li key={key}>{`${step.label}: ${step.status}`}</li>
				))}
			</ol>
			<div aria-hidden="true" className="flex shrink-0 items-center gap-1">
				{withKeys(block.steps, (step) => step.label, "dot").map(({ key, item: step }) => (
					<span key={key} className={`size-1.5 rounded-full ${STEP_DOT[step.status]}`} />
				))}
			</div>
			<span className={`min-w-0 break-words ${STEP_TONE[current.status]}`}>{current.label}</span>
			<span className="flex shrink-0 items-center gap-1 text-fg-subtle">
				<span aria-hidden="true">·</span>
				<span>{`${index + 1}/${block.steps.length}`}</span>
			</span>
			{word === undefined ? null : (
				<span className={`shrink-0 font-medium ${STEP_TONE[current.status]}`}>{word}</span>
			)}
		</div>
	);
}

function Block({ block }: { block: ProgressBlock }) {
	switch (block.kind) {
		case "bar":
			return <BarBlock block={block} />;
		case "steps":
			return <StepsBlock block={block} />;
		case "text":
			return <p className="text-xs text-fg-muted break-words">{block.text}</p>;
	}
}

export function ProgressTracker({ sessionId }: ProgressTrackerProps) {
	const { services } = useServices();
	const progress = useStore(services.sessions.store, (state) => state.progress[sessionId]);
	if (progress === undefined || progress.blocks.length === 0) return null;
	return (
		<section
			aria-label="Progress"
			className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 shadow-xs"
		>
			{progress.title === undefined ? null : (
				<p className="text-xs font-medium text-fg">{progress.title}</p>
			)}
			{withKeys(progress.blocks, (block) => block.kind, "block").map(({ key, item: block }) => (
				<Block key={key} block={block} />
			))}
		</section>
	);
}
