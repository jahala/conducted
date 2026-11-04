/**
 * @feature CHAT-06 Chat banners
 * Owns: Notices and errors in the list: interrupted, history compacted, compacting, session limit
 * reached, sign-in needed, image too large, 'This message could not be displayed.'.
 * Behaviour: ui-map.md 3.3 (Banners in the list), 7.4 (agent binary and auth problems are shown
 * inline in chat).
 * Our design choice: Sign-in and key problems link to the Agents settings page and name the exact
 * agent. Retryable errors show 'Try again', which resends the last message.
 * Must handle: Each notice kind has its own wording (the protocol's notice kinds: session_started,
 * compacted, rate_limit, model_changed, info); an error with `retryable` false has no retry; text
 * is selectable; error colour only for real errors, not for notices.
 * Test first: A 'compacted' notice reads as a quiet line; a retryable error shows a Try again
 * button.
 */
import { notImplemented } from "@conducted/shared";
import type { ChatBlock } from "../../core/model.ts";

export interface ChatBannerProps {
	block: Extract<ChatBlock, { kind: "notice" | "error" }>;
}

export function ChatBanner(_props: ChatBannerProps): never {
	return notImplemented("CHAT-06");
}
