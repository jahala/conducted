/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: the usage section at the bottom of the context card for Claude and Codex chats: the
 * "Claude usage" or "Codex usage" heading, each plan limit window with how much is left, its bar
 * and its reset time, the warning near a limit, and the rows that say who the agent is signed in
 * as.
 * Behaviour: Conductor's card (renderApp `TGi`, `SXo`, `yXo`, `xXo`: a window is named from its
 * length ("5h limit", "7d limit", "90m limit"), shows "N% left", warns at 20 percent left or less,
 * and is dropped once its reset time has passed; `BXo` and `EGi`: the rows Provider, Plan,
 * Login method or Auth, and Email, which Codex calls Account); claude-runner.md 7 (plan usage
 * windows, failures leave the rows out); coverage/inventory-controls.md ("Account details in the
 * plan usage popover").
 * Data: the sidecar's `getContextUsage` answer, which ContextWheel asks for when its card opens.
 * Must handle: an answer still on its way ("Loading usage…"); no answer or no window (the
 * provider note); an account with only some fields (only those rows); a limit above 100 percent
 * (0% left); a reset time that is not known ("Resets reset time unavailable"); a long email (cut,
 * whole in its title); the email being private (shown only here, never logged).
 * Our design choice: Conductor also lists the organization elsewhere; its popover leaves it out,
 * and so does this one. Codex's "Using ChatGPT plan" row for an OpenAI-hosted model is not built.
 * Test first: a Claude account with plan "Max" and login method "Claude account" shows those rows
 * and no Organization row.
 */
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import { cn } from "../../ui/cn.ts";
import { Spinner } from "../../ui/Spinner.tsx";

type ContextUsageAnswer = ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>;

/** The signed-in account in the sidecar's usage answer. */
export type UsageAccount = NonNullable<ContextUsageAnswer["account"]>;

/** The parts of the usage answer this section draws. */
export type UsageAnswer = Pick<ContextUsageAnswer, "rateLimits" | "account">;

export interface UsageAccountRowsProps {
	agent: "claude" | "codex";
	/** Null before an answer arrives, or when the sidecar could not give one. */
	answer: UsageAnswer | null;
	loading: boolean;
	/** The current time in milliseconds, passed in so the reset text can be tested. */
	now: number;
}

/** At or below this many percent left, the window turns to the warning colour (Conductor's `kGi`). */
const LOW_PERCENT_LEFT = 20;

const AGENT_NAME = { claude: "Claude", codex: "Codex" } as const;

/** Conductor's window name: whole days, whole hours, else minutes. */
function windowName(limit: RateLimit): string {
	const minutes = limit.windowMinutes;
	if (minutes === undefined) return limit.label;
	if (minutes % 1440 === 0) return `${minutes / 1440}d limit`;
	if (minutes % 60 === 0) return `${minutes / 60}h limit`;
	return `${minutes}m limit`;
}

/** The reset time as Conductor writes it: a short date, then the time. */
function resetText(resetsAt: number | undefined): string {
	if (resetsAt === undefined) return "reset time unavailable";
	const at = new Date(resetsAt);
	const date = at.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const time = at.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	return `${date}, ${time}`;
}

interface WindowView {
	name: string;
	left: number;
	resetsAt: number | undefined;
}

function windowsOf(limits: readonly RateLimit[], now: number): WindowView[] {
	return limits
		.filter((limit) => limit.resetsAt === undefined || limit.resetsAt > now)
		.map((limit) => ({
			name: windowName(limit),
			left: Math.max(0, 100 - limit.usedPercent),
			resetsAt: limit.resetsAt,
		}));
}

function WindowRow({ window }: { window: WindowView }) {
	const low = window.left <= LOW_PERCENT_LEFT;
	const left = Math.round(window.left);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex justify-between gap-4 text-xs">
				<span className="text-fg-muted">{window.name}</span>
				<span className={cn("font-medium tabular-nums", low ? "text-warning" : "text-fg")}>
					{left}% left
				</span>
			</div>
			<div
				role="progressbar"
				aria-label={window.name}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={left}
				className="h-1.5 w-full overflow-hidden rounded-sm bg-border"
			>
				<div
					className={cn("h-full rounded-sm", low ? "bg-warning" : "bg-fg")}
					style={{ width: `${window.left}%` }}
				/>
			</div>
			<div className="text-2xs text-fg-muted">Resets {resetText(window.resetsAt)}</div>
		</div>
	);
}

/** The account rows in Conductor's order. Codex names its email row Account. */
function accountRows(
	agent: UsageAccountRowsProps["agent"],
	account: UsageAccount | undefined,
): { label: string; value: string }[] {
	if (account === undefined) return [];
	const rows: { label: string; value: string | undefined }[] = [
		{ label: "Provider", value: account.provider },
		{ label: "Plan", value: account.plan },
		{ label: "Login method", value: account.loginMethod },
		{ label: "Auth", value: account.auth },
		{ label: agent === "codex" ? "Account" : "Email", value: account.email },
	];
	return rows.filter((row): row is { label: string; value: string } => (row.value ?? "") !== "");
}

/** The usage section of the context card for a Claude or Codex chat. */
export function UsageAccountRows({ agent, answer, loading, now }: UsageAccountRowsProps) {
	const name = AGENT_NAME[agent];
	const windows = windowsOf(answer?.rateLimits ?? [], now);
	const low = windows.some((window) => window.left <= LOW_PERCENT_LEFT);
	const rows = accountRows(agent, answer?.account);

	return (
		<div className="flex flex-col gap-2 border-t border-border pt-2 text-xs">
			<span className="text-sm font-medium text-fg">{name} usage</span>
			{windows.length > 0 ? (
				<div className="flex flex-col gap-2">
					{windows.map((window) => (
						<WindowRow key={window.name} window={window} />
					))}
				</div>
			) : loading ? (
				<div className="flex items-center gap-2 text-fg-muted">
					<Spinner size="sm" label="Loading usage" />
					<span>Loading usage…</span>
				</div>
			) : (
				<p className="text-fg-muted">
					Usage data unavailable from provider. It refreshes after {name} responds.
				</p>
			)}
			{low ? <p className="text-warning">You're approaching your {name} usage limit.</p> : null}
			{rows.length === 0 ? null : (
				<ul aria-label="Account" className="flex flex-col border-t border-border pt-1">
					{rows.map((row) => (
						<li key={row.label} className="flex justify-between gap-4 py-0.5">
							<span className="shrink-0 text-fg-muted">{row.label}</span>
							<span title={row.value} className="min-w-0 truncate text-fg-subtle">
								{row.value}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
