/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: the rows at the bottom of the usage hover card that say who the agent is signed in as
 * (login method, organization, email, plan) and the plan usage rows with their bars.
 * Behaviour: coverage/inventory-controls.md ("Account details in the plan usage popover": "Login
 * method", "Organization", "Email" and "Plan"; for Codex primary and secondary limits, and a note
 * when usage data is not available yet); claude-runner.md 7 (plan usage: five-hour and seven-day
 * windows, each with a used percentage and a reset time; failures leave the rows out).
 * Data: the sidecar's `getContextUsage` answer carries `account` and `rateLimits`.
 * Must handle: an account with only some fields (only the rows that have a value are shown); no
 * account and no limits (nothing shown, and no empty heading); an email that is long (cut in the
 * middle, full text in a tooltip); a limit above 100 percent (clamped for the bar, the number shown
 * as reported); a reset time in the past (shown as "Resetting"); a window length of 300 or 10,080
 * minutes (named "5 hours" and "Weekly", other lengths named from the minutes); Codex that has not
 * reported yet (the "not available yet" note, not zero percent); the email being private (it is
 * shown only inside this popover and never logged).
 * Test first: an account with login method "Claude subscription" and plan "Max" shows two rows and
 * no Organization or Email row.
 */
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import { TruncatedText } from "../../ui/TruncatedText.tsx";

/** The signed-in account in the sidecar's usage answer. */
export type UsageAccount = NonNullable<
	ResultOf<(typeof appToSidecarRequests)["getContextUsage"]>["account"]
>;

export interface UsageAccountRowsProps {
	account: UsageAccount | null;
	rateLimits: readonly RateLimit[];
	/** Codex has not sent its limits yet. */
	limitsPending: boolean;
	/** The current time in milliseconds, passed in so the reset text can be tested. */
	now: number;
}

const FIVE_HOURS_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
const EMAIL_MAX_LENGTH = 38;

function windowName(minutes: number | undefined): string | null {
	if (minutes === undefined) return null;
	if (minutes === FIVE_HOURS_MINUTES) return "5 hours";
	if (minutes === WEEK_MINUTES) return "Weekly";
	return `${minutes} minutes`;
}

function resetText(resetsAt: number | undefined, now: number): string | null {
	if (resetsAt === undefined) return null;
	if (resetsAt <= now) return "Resetting";
	const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
	if (minutes < 60) return `Resets in ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	if (hours < 24) return restMinutes === 0 ? `Resets in ${hours}h` : `Resets in ${hours}h ${restMinutes}m`;
	const days = Math.floor(hours / 24);
	const restHours = hours % 24;
	return restHours === 0 ? `Resets in ${days}d` : `Resets in ${days}d ${restHours}h`;
}

function RateLimitRow({ limit, now }: { limit: RateLimit; now: number }) {
	const clamped = Math.max(0, Math.min(100, limit.usedPercent));
	const window = windowName(limit.windowMinutes);
	const reset = resetText(limit.resetsAt, now);
	const name = limit.label === "" ? (window ?? "Usage") : limit.label;
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2 text-xs">
				<span className="min-w-0 truncate text-fg">{name}</span>
				<span className="shrink-0 tabular-nums text-fg-muted">{limit.usedPercent}%</span>
			</div>
			<div
				role="progressbar"
				aria-label={name}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={clamped}
				className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
			>
				<div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
			</div>
			{window === null && reset === null ? null : (
				<div className="mt-1 flex items-baseline justify-between gap-2 text-2xs text-fg-subtle">
					<span>{window}</span>
					<span>{reset}</span>
				</div>
			)}
		</div>
	);
}

/** The account and plan-usage rows below the context details. Nothing when there is nothing to say. */
export function UsageAccountRows({ account, rateLimits, limitsPending, now }: UsageAccountRowsProps) {
	const rows: { label: string; value: string; truncated?: boolean }[] = [];
	if (account !== null) {
		if (account.loginMethod !== undefined && account.loginMethod !== "") {
			rows.push({ label: "Login method", value: account.loginMethod });
		}
		if (account.organization !== undefined && account.organization !== "") {
			rows.push({ label: "Organization", value: account.organization });
		}
		if (account.email !== undefined && account.email !== "") {
			rows.push({ label: "Email", value: account.email, truncated: true });
		}
		if (account.plan !== undefined && account.plan !== "") {
			rows.push({ label: "Plan", value: account.plan });
		}
	}
	const hasLimits = rateLimits.length > 0;
	const showPending = limitsPending && !hasLimits;
	if (rows.length === 0 && !hasLimits && !showPending) return null;

	return (
		<div className="mt-2 flex flex-col gap-3 border-t border-border pt-2">
			{hasLimits ? (
				<div className="flex flex-col gap-2">
					<span className="font-medium text-fg">Plan usage</span>
					{rateLimits.map((limit, index) => (
						<RateLimitRow key={`${limit.label}-${index}`} limit={limit} now={now} />
					))}
				</div>
			) : null}
			{showPending ? (
				<p className="text-xs text-fg-muted">Usage data is not available yet.</p>
			) : null}
			{rows.length === 0 ? null : (
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					{rows.map((row) => (
						<div key={row.label} className="contents">
							<dt className="text-fg-muted">{row.label}</dt>
							<dd className="min-w-0">
								{row.truncated === true ? (
									<TruncatedText text={row.value} maxLength={EMAIL_MAX_LENGTH} />
								) : (
									row.value
								)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}
