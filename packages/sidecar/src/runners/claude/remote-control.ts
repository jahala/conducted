/**
 * @feature RC-02 Per-chat Remote Control switch and connection status
 * Owns: the Claude pieces of Remote Control (D019) that need no session state: turning it on or
 * off through the SDK query object's `enableRemoteControl`, reading the bridge's state messages,
 * saying why a chat cannot use it, and reading which user messages a frame answers (RC-03).
 * Behaviour: docs/plans/cloud-and-remote.md Part 2 and its spike result (D074, path A). The method
 * is on the query object but not in the SDK's public types; it answers `{ session_url,
 * bridge_session_id, bridge_epoch, ... }`, and the stream reports `system`/`bridge_state` messages
 * (`ready`, then `connected`). Anthropic documents that Remote Control needs a claude.ai login, so
 * an API key cannot use it, and that it is off when ANTHROPIC_BASE_URL points away from Anthropic,
 * and for Bedrock and Vertex.
 * Must handle: an SDK without the method (an error the app sees, never a silent off); an answer
 * without `session_url` or `bridge_session_id` (an error: the SDK changed, D074); Claude refusing
 * (its own words are kept); `policy_disabled` (a failure with Claude's detail); a state this code
 * does not know (ignored, so a new state never shows a wrong label); an empty key variable (not a
 * key); a base URL that does not parse (treated as pointing away).
 * Test first: an answer without `bridge_session_id` is an error.
 * Our design choice: the session is not given a name, so Claude names it as it names its own
 * sessions; the research has no name for it.
 */
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RemoteControlStatus } from "@conducted/protocol";
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";

/**
 * How often, and how many times, Claude's transcript is read for the text of a message typed on
 * claude.ai, since the line can land a little after the first frame that names it. Our design
 * choice: every 250 ms, 8 times (2 s); the research has no number.
 */
export const REMOTE_TEXT_RETRY_MS = 250;
export const REMOTE_TEXT_ATTEMPTS = 8;

/** The chat's note where the app's approval card closed because claude.ai answered first. */
export const ANSWERED_VIA_CLAUDE = "Answered via Claude.";

/** What the host gives a Claude chat for Remote Control. The session manager passes them for every chat. */
export interface RemoteControlCallbacks {
	/** The link's state changed: asked for, connected, lost, failed or turned off. */
	onStatus(status: RemoteControlStatus): void;
	/**
	 * A user message typed on claude.ai started a turn or joined the running one (RC-03). The call
	 * comes when the first frame names it, so the host can place it in the turn that is open now;
	 * `text` resolves with what Claude's transcript holds, or null when the line never appeared.
	 */
	onUserMessage(message: { uuid: string; text: Promise<string | null> }): void;
}

/** What turning Remote Control on gave back: the page that opens the chat on claude.ai. */
interface RemoteControlLink {
	sessionUrl?: string;
}

/** The query object as the pinned SDK builds it, with the method its types leave out. */
interface RemoteControlQuery {
	enableRemoteControl?: (enabled: boolean, name?: string) => Promise<unknown>;
}

/**
 * Turns Remote Control on or off for the process behind `query`. Turning it on answers the
 * session link; turning it off answers nothing.
 */
export async function setRemoteControl(
	query: Query,
	enabled: boolean,
): Promise<Result<RemoteControlLink, AppError>> {
	const method = (query as unknown as RemoteControlQuery).enableRemoteControl;
	if (typeof method !== "function") {
		return err(
			appError(
				"remote_control_unsupported",
				"This version of the Claude Agent SDK cannot start Remote Control.",
			),
		);
	}
	let answer: unknown;
	try {
		answer = await method.call(query, enabled);
	} catch (cause) {
		return err(appError("remote_control_failed", messageOf(cause), cause));
	}
	if (!enabled) return ok({});
	const record = (typeof answer === "object" && answer !== null ? answer : {}) as Record<
		string,
		unknown
	>;
	const sessionUrl = record.session_url;
	const bridgeSessionId = record.bridge_session_id;
	if (
		typeof sessionUrl !== "string" ||
		sessionUrl === "" ||
		typeof bridgeSessionId !== "string" ||
		bridgeSessionId === ""
	) {
		return err(
			appError(
				"remote_control_answer_changed",
				"Claude turned Remote Control on but did not say where to open the chat.",
			),
		);
	}
	return ok({ sessionUrl });
}

/** The bridge states this code shows, by the name Claude sends. */
const BRIDGE_STATES: ReadonlySet<string> = new Set([
	"connecting",
	"ready",
	"connected",
	"reconnecting",
	"disconnected",
	"failed",
]);

/** The link state a `system`/`bridge_state` message reports, or null for any other message. */
export function bridgeStatusOf(
	message: SDKMessage,
): Pick<RemoteControlStatus, "state" | "detail"> | null {
	const record = message as unknown as {
		type?: unknown;
		subtype?: unknown;
		state?: unknown;
		detail?: unknown;
	};
	if (record.type !== "system" || record.subtype !== "bridge_state") return null;
	const detail = typeof record.detail === "string" && record.detail !== "" ? record.detail : null;
	const withDetail = detail === null ? {} : { detail };
	if (record.state === "policy_disabled") return { state: "failed", ...withDetail };
	if (typeof record.state !== "string" || !BRIDGE_STATES.has(record.state)) return null;
	return { state: record.state as RemoteControlStatus["state"], ...withDetail };
}

const ANTHROPIC_HOST = /(^|\.)anthropic\.com$/i;

function isOn(value: string | undefined): boolean {
	if (value === undefined) return false;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * Why this agent environment cannot use Remote Control, or null when it can. The words are shown
 * to the user under the chat's Remote Control switch.
 */
export function remoteControlBlocker(
	env: Readonly<Record<string, string | undefined>>,
): string | null {
	if ((env.ANTHROPIC_API_KEY ?? "") !== "" || (env.ANTHROPIC_AUTH_TOKEN ?? "") !== "") {
		return "Remote Control needs a claude.ai login. This chat runs on an API key.";
	}
	if (isOn(env.CLAUDE_CODE_USE_BEDROCK) || isOn(env.CLAUDE_CODE_USE_VERTEX)) {
		return "Remote Control does not work with Bedrock or Vertex.";
	}
	const baseUrl = env.ANTHROPIC_BASE_URL ?? "";
	if (baseUrl !== "") {
		let host = "";
		try {
			host = new URL(baseUrl).hostname;
		} catch {
			host = "";
		}
		if (!ANTHROPIC_HOST.test(host)) {
			return "Remote Control is off while ANTHROPIC_BASE_URL points away from Anthropic.";
		}
	}
	return null;
}

/**
 * The user messages a main-thread frame answers, by the uuid their sender gave them (RC-03). A
 * sub-agent frame answers none of the user's messages.
 */
export function remoteUserMessageUuids(message: SDKMessage): string[] {
	const record = message as unknown as {
		parent_tool_use_id?: unknown;
		user_message_uuid?: unknown;
		user_message_uuids?: unknown;
	};
	if (typeof record.parent_tool_use_id === "string") return [];
	const uuids: string[] = [];
	if (Array.isArray(record.user_message_uuids)) {
		for (const uuid of record.user_message_uuids) {
			if (typeof uuid === "string" && uuid !== "" && !uuids.includes(uuid)) uuids.push(uuid);
		}
	}
	const last = record.user_message_uuid;
	if (typeof last === "string" && last !== "" && !uuids.includes(last)) uuids.push(last);
	return uuids;
}
