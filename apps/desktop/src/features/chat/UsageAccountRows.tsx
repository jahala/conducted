/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: the rows at the bottom of the usage hover card that say who the agent is signed in as (login
 * method, organization, email, plan) and, for Codex, the primary and secondary limits.
 * Behaviour: coverage/inventory-controls.md ("Account details in the plan usage popover": "Auth" or "Login
 * method", "Organization", "Email" and "Plan"; for Codex also primary and secondary limits, and a note when
 * usage data is not available yet); claude-runner.md 7 (plan usage: subscription type and the five-hour and
 * seven-day windows, each with a used percentage and a reset time; failures are swallowed, so the rows are
 * simply absent).
 * Data: the sidecar's `getContextUsage` answer carries `account` and `rateLimits` (packages/protocol
 * rpc.ts). The popover in ContextWheel.tsx (CHAT-14) passes them in; this component only draws them.
 * Must handle: an account with only some fields (only the rows that have a value are shown); no account
 * and no limits (nothing shown, and no empty heading); an email that is long (cut in the middle, full text
 * in a tooltip); a limit above 100 percent (clamped for the bar, the number shown as reported); a reset time
 * in the past (shown as "resetting"); a window length of 300 or 10,080 minutes (named "5 hours" and
 * "Weekly", other lengths named from the minutes); Codex that has not reported yet (the "not available yet"
 * note, not zero percent); the email being private (it is shown only inside this popover and never logged).
 * Test first: an account with login method "Claude subscription" and plan "Max" shows two rows and no
 * Organization or Email row.
 */
import type { appToSidecarRequests, RateLimit, ResultOf } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

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

export function UsageAccountRows(_props: UsageAccountRowsProps): never {
	return notImplemented("CHAT-28");
}
