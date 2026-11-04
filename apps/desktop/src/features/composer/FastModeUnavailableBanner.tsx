/**
 * @feature CHAT-30 Fast mode unavailable banner
 * Owns: the dismissible warning above the composer: "Fast mode is disabled because extra usage is out of
 * credits." with an "Add credit" button.
 * Behaviour: coverage/inventory-controls.md (a dismissible warning above the composer with "Add credit",
 * which opens the Claude usage page); claude-runner.md 1.2 and 8 (the CLI's stderr line "Fast mode requires
 * extra usage billing" makes the runner set `liveState.fastModeAvailable = false`); ui-map.md 3.5 (the
 * "/fast" command and the Fast mode toggle).
 * Data: `LiveState.fastModeAvailable` (packages/protocol live-state.ts) through useChat. The page opens
 * through `Actions.app.openUrl`.
 * Our design choice: dismissal lasts for the chat and returns when fast mode is turned on again and fails
 * again. The warning uses the warning colour token because it is a function-only state.
 * Must handle: fast mode available (nothing shown); fast mode turned off by the user (nothing shown, since
 * there is nothing to warn about); a chat on an agent without fast mode (nothing shown); dismissal
 * remembered while the chat stays open; the banner appearing while the user types (no focus steal); the
 * button failing to open the page (a short error beside it).
 * Test first: with fastModeAvailable false and fast mode requested, the banner shows the sentence and a
 * dismiss control; dismissing hides it until fastModeAvailable turns true and false again.
 */
import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface FastModeUnavailableBannerProps {
	sessionId: SessionId;
	/** The user asked for fast mode in this chat. */
	fastModeRequested: boolean;
	/** `LiveState.fastModeAvailable`. */
	fastModeAvailable: boolean;
}

export function FastModeUnavailableBanner(_props: FastModeUnavailableBannerProps): never {
	return notImplemented("CHAT-30");
}
