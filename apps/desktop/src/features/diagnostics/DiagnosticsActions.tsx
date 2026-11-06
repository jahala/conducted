/**
 * @feature APP-03 Diagnostics actions
 * Owns: the row of buttons on the diagnostics page: copy the redacted report, copy the full
 * report, start a chat with the redacted report attached, copy the logs, and restart.
 * Behaviour: ui-map.md 2, `/diagnostics` (button list; "Copy logs (may include personal data)").
 * Must handle: a busy action disabling the others and showing its own spinner, the chat action
 * disabled when no workspace exists, and the Restart hint that says it asks first while an agent
 * is working.
 * Our design choice: the row is presentational. Confirmation, clipboard writes and the restart
 * belong to DiagnosticsScreen, which owns the side effects.
 * Test first: each button calls onAction with its own id, and a busy action disables the others.
 */
import { Button } from "../../ui/Button.tsx";

export type DiagnosticsAction =
	| "copy_redacted"
	| "copy_full"
	| "start_chat"
	| "copy_logs"
	| "restart";

export interface DiagnosticsActionsProps {
	busy: DiagnosticsAction | null;
	canStartChat: boolean;
	agentsWorking: boolean;
	onAction: (action: DiagnosticsAction) => void;
}

export function DiagnosticsActions({
	busy,
	canStartChat,
	agentsWorking,
	onAction,
}: DiagnosticsActionsProps) {
	const disabled = busy !== null;
	return (
		<fieldset
			className="m-0 flex flex-wrap items-center gap-2 border-0 p-0"
			aria-label="Diagnostics actions"
		>
			<Button
				variant="default"
				onClick={() => onAction("copy_redacted")}
				disabled={disabled}
				loading={busy === "copy_redacted"}
			>
				Copy redacted report
			</Button>
			<Button
				variant="outline"
				onClick={() => onAction("copy_full")}
				disabled={disabled}
				loading={busy === "copy_full"}
			>
				Copy full report
			</Button>
			<Button
				variant="outline"
				onClick={() => onAction("start_chat")}
				disabled={disabled || !canStartChat}
				loading={busy === "start_chat"}
				title={
					canStartChat ? undefined : "Create a workspace before starting a chat from diagnostics."
				}
			>
				Create a new session with the redacted report attached
			</Button>
			<Button
				variant="outline"
				onClick={() => onAction("copy_logs")}
				disabled={disabled}
				loading={busy === "copy_logs"}
			>
				Copy logs (may include personal data)
			</Button>
			<Button
				variant="outlineDestructive"
				onClick={() => onAction("restart")}
				disabled={disabled}
				loading={busy === "restart"}
				title={
					agentsWorking
						? "An agent is working. You will be asked before the app restarts."
						: undefined
				}
			>
				Restart
			</Button>
		</fieldset>
	);
}
