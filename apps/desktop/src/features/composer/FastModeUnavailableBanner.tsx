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
import { useEffect, useState } from "react";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";

/** The Claude page where extra usage credits are checked and bought. */
const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
const MESSAGE = "Fast mode is disabled because extra usage is out of credits.";

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
	const [openError, setOpenError] = useState<string | null>(null);

	// A fresh failure shows the warning again: it was dismissed only for the failure before it.
	useEffect(() => {
		if (fastModeAvailable) {
			setDismissedSession((current) => (current === sessionId ? null : current));
		}
		setOpenError(null);
	}, [fastModeAvailable, sessionId]);

	if (!fastModeRequested || fastModeAvailable || dismissedSession === sessionId) return null;

	const addCredit = async () => {
		setOpenError(null);
		const opened = await actions.app.openUrl(CLAUDE_USAGE_URL);
		if (!opened.ok) setOpenError(opened.error.message);
	};

	return (
		<div
			data-tone="warning"
			className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface px-2 py-1.5 text-warning-fg"
		>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium">{MESSAGE}</p>
				{openError === null ? null : (
					<p role="alert" className="mt-1 text-xs text-danger">
						{openError}
					</p>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button variant="outline" size="xs" onClick={() => void addCredit()}>
					Add credit
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
		</div>
	);
}
