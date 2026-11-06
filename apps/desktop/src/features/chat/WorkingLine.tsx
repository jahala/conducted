/**
 * @feature CHAT-06 Working line
 * Owns: the line at the end of the chat while the agent works: three pulsing dots and a running timer, or,
 * while the turn waits on background work, what it waits for ("Waiting for 4 background tasks") and for how
 * long.
 * Behaviour: measured from Conductor 0.92.1 (renderApp @9482762 and the list footer @9604644): a 32px line
 * in the chat column, the dots at 12px, 12px apart from the timer; the timer in muted monospace text-xs with
 * wider tracking, written "27.4s" or "1m, 46.2s" and counted from when the turn's message was sent, or from
 * when the wait began. The waiting words: one task "Waiting for task <description>" (or "Waiting for
 * subagent <description>", "Waiting for agent", "Waiting for background task"); several "Waiting for N
 * agents" when all are sub-agents, else "Waiting for N background tasks".
 * Must handle: no tasks while waiting (the background-task words); a start time in the future (shows 0.0s);
 * the timer's interval is cleared on unmount.
 * Test first: two shell tasks read "Waiting for 2 background tasks"; 106,200ms reads "1m, 46.2s".
 */
import type { LiveState } from "@conducted/protocol";
import { Spinner } from "../../ui/Spinner.tsx";
import { useNow } from "../sidebar/use-now.ts";

type BackgroundTask = LiveState["backgroundTasks"][number];

/** How long the agent has worked, as Conductor writes it: "27.4s", "1m, 46.2s". */
export function formatElapsed(ms: number): string {
	const safe = Math.max(0, ms);
	const seconds = Math.floor(safe / 1000);
	const minutes = Math.floor(seconds / 60);
	const tenths = Math.floor((safe % 1000) / 100);
	const rest = `${seconds % 60}.${tenths}s`;
	return minutes > 0 ? `${minutes}m, ${rest}` : rest;
}

/** What a waiting turn waits for, in Conductor's words. */
export function waitingWords(tasks: readonly BackgroundTask[]): string {
	const [only] = tasks;
	if (tasks.length === 1 && only !== undefined) {
		const agent = only.kind === "sub_agent";
		if (only.description !== "") {
			return agent
				? `Waiting for subagent ${only.description}`
				: `Waiting for task ${only.description}`;
		}
		return agent ? "Waiting for agent" : "Waiting for background task";
	}
	if (tasks.length === 0) return "Waiting for background task";
	return tasks.every((task) => task.kind === "sub_agent")
		? `Waiting for ${tasks.length} agents`
		: `Waiting for ${tasks.length} background tasks`;
}

const TICK_MS = 100;

export function WorkingLine({
	since,
	waiting,
	read = Date.now,
}: {
	/** When the turn's message was sent, in milliseconds since the epoch. */
	since: number;
	/** Set while the turn waits on background work. */
	waiting?: { since: number; tasks: readonly BackgroundTask[] };
	/** The clock, passed in by tests and the catalogue. */
	read?: () => number;
}) {
	const now = useNow(read, TICK_MS);
	return (
		<div className="mx-auto flex h-8 w-full max-w-[var(--chat-column-width)] items-center gap-3 px-7">
			<Spinner kind="typing" label="The agent is working" className="w-3 text-fg-muted" />
			{waiting === undefined ? null : (
				<span className="min-w-0 truncate text-xs text-fg-muted">
					{waitingWords(waiting.tasks)}
				</span>
			)}
			<span className="font-mono text-xs tracking-wider text-fg-muted">
				{formatElapsed(now - (waiting?.since ?? since))}
			</span>
		</div>
	);
}
