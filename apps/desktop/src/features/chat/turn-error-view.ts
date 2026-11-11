/**
 * @feature CHAT-06 The view of a failed turn's error
 * Owns: choosing which view the banner of a failed turn shows, from the turn's error text and the
 * chat's agent.
 * Behaviour: Conductor shows the error that ended a turn (its own `error` message) through IQi
 * (renderApp @9538488). Its branches, in order: an abort by the user reads "Interrupted by user";
 * a Claude chat's sign-in error offers sign-in; "prompt is too long" is the context window;
 * "Claude AI usage limit reached|<seconds>" is the session limit with its reset time; "overloaded"
 * is an overloaded server; "image exceeds 5 mb" is an image over the size limit; anything else is
 * shown as "Error: <text>", and no text as "Unknown error". The text is first reworded by TQi
 * @9537800 ("Session cancelled:" reads "Session interrupted:").
 * Not built: IQi's branches for Codex, Cursor and a cloud host's network or update errors, its
 * retry-in-progress badge (our retry line is ChatRetryBanner), and the spend-cap wording of a team
 * workspace (Hqr).
 * Test first: a user's abort reads as Interrupted by user; the session limit and its reset time
 * are read.
 */
import { isClaudeSignInErrorText } from "@conducted/protocol";
import type { AgentKind } from "@conducted/shared";

export type TurnErrorView =
	| { kind: "interrupted" }
	| { kind: "sign_in"; text: string }
	| { kind: "context_window" }
	/** resetsAt: milliseconds since the epoch, or null when the text names no time. */
	| { kind: "session_limit"; resetsAt: number | null }
	| { kind: "overloaded" }
	| { kind: "image_too_large" }
	| { kind: "error"; text: string };

const SESSION_LIMIT = "Claude AI usage limit reached|";

export function turnErrorView(error: string | null, agent: AgentKind | undefined): TurnErrorView {
	const text = error?.replace(/^Session cancelled:/, "Session interrupted:");
	if (text === undefined) return { kind: "error", text: "Unknown error" };
	const lower = text.toLowerCase();
	if (text.includes("aborted by user") || text.includes("Interrupted by user")) {
		return { kind: "interrupted" };
	}
	if (agent === "claude" && isClaudeSignInErrorText(text)) return { kind: "sign_in", text };
	if (lower.includes("prompt is too long")) return { kind: "context_window" };
	if (text.includes(SESSION_LIMIT)) return { kind: "session_limit", resetsAt: resetTime(text) };
	if (lower.includes("overloaded")) return { kind: "overloaded" };
	if (lower.includes("image exceeds 5 mb")) return { kind: "image_too_large" };
	return { kind: "error", text };
}

/** The reset time after the bar, in seconds as the CLI writes it. Only "<text>|<seconds>" has one. */
function resetTime(text: string): number | null {
	const parts = text.split("|");
	if (parts.length !== 2) return null;
	const seconds = Number.parseInt((parts[1] ?? "").trim(), 10);
	return Number.isNaN(seconds) ? null : seconds * 1000;
}
