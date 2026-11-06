/**
 * @feature CHAT-30 Fast mode unavailable banner
 * Owns: the dismissible warning above the composer: "Fast mode is disabled because extra usage is out of
 * credits."
 * Behaviour: coverage/inventory-controls.md (a dismissible warning above the composer with "Add credit",
 * which opens the Claude usage page); Conductor's renderApp (`zda` is https://claude.ai/settings/usage,
 * the ghost "Add credit" button with an up-right arrow, `t1a` opens the page); claude-runner.md 1.2 and 8 (the CLI's stderr line "Fast mode requires
 * extra usage billing" makes the runner set `liveState.fastModeAvailable = false`); ui-map.md 3.5 (the
 * "/fast" command and the Fast mode toggle).
 * Data: `LiveState.fastModeAvailable` (packages/protocol live-state.ts) through useChat.
 * Our design choice: dismissal lasts for the chat and returns when fast mode is turned on again and fails
 * again. The warning uses the warning colour token because it is a function-only state.
 * Must handle: fast mode available (nothing shown); fast mode turned off by the user (nothing shown, since
 * there is nothing to warn about); a chat on an agent without fast mode (nothing shown); dismissal
 * remembered while the chat stays open; the banner appearing while the user types (no focus steal); a
 * usage page that cannot be opened (a toast; Our design choice: Conductor opens it without a word).
 * Test first: with fastModeAvailable false and fast mode requested, the banner shows the sentence, Add
 * credit and a dismiss control; Add credit opens the usage page; dismissing hides it until
 * fastModeAvailable turns true and false again.
 */
import type { SessionId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { ArrowUpRightIcon, CloseIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";

const MESSAGE = "Fast mode is disabled because extra usage is out of credits.";
/** Claude's usage page, where extra usage credit is bought. */
const USAGE_URL = "https://claude.ai/settings/usage";

export interface FastModeUnavailableBannerProps {
	sessionId: SessionId;
	/** The user asked for fast mode in this chat. */
	fastModeRequested: boolean;
	/** `LiveState.fastModeAvailable`. */
	fastModeAvailable: boolean;
}

export function FastModeUnavailableBanner({
	sessionId,
	fastModeRequested,
	fastModeAvailable,
}: FastModeUnavailableBannerProps) {
	const actions = useActions();
	const [dismissedSession, setDismissedSession] = useState<SessionId | null>(null);

	// A fresh failure shows the warning again: it was dismissed only for the failure before it.
	useEffect(() => {
		if (fastModeAvailable) {
			setDismissedSession((current) => (current === sessionId ? null : current));
		}
	}, [fastModeAvailable, sessionId]);

	if (!fastModeRequested || fastModeAvailable || dismissedSession === sessionId) return null;

	return (
		<div
			data-tone="warning"
			className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-2 py-1.5 text-warning-fg"
		>
			<p className="min-w-0 flex-1 text-xs font-medium">{MESSAGE}</p>
			<Button
				variant="ghost"
				size="xs"
				onClick={() => {
					void actions.app.openUrl(USAGE_URL).then((result) => {
						if (!result.ok) toastError("Couldn't open the browser", result.error);
					});
				}}
				className="shrink-0 gap-1 px-1.5 text-warning-fg hover:bg-hover hover:text-warning-fg"
			>
				Add credit
				<ArrowUpRightIcon className="size-3" />
			</Button>
			<button
				type="button"
				aria-label="Dismiss fast mode warning"
				onClick={() => setDismissedSession(sessionId)}
				className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-warning-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<CloseIcon className="size-3.5" />
			</button>
		</div>
	);
}
