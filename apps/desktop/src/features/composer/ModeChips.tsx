/**
 * @feature COMP-03 Plan mode and approval toggles
 * Owns: The plan mode and auto-accept edits toggles in the composer.
 * Behaviour: ui-map.md 3.5 (the 'Auto-accept edits' chip with the tooltip 'Disable auto-accept
 * edits', and plan mode with Shift+Tab), 5.4 (Shift+Tab while typing), claude-runner.md 3.
 * Measured from Conductor 0.92.1: the on state of "Auto-accept edits" is a 24px chip in the link fill and
 * colour; a pressed composer toggle is a round foreground fill. Conductor shows the auto-accept chip only
 * while it is on and keeps plan mode in the "+" menu; ours keeps both toggles in the row (listed as ours).
 * Our design choice: plan mode is the chat's stored `planMode`, so it goes through
 * sessions.updateConfig. Auto-accept edits is Claude's live accept-edits mode, which the stored
 * config does not hold, so it goes through sessions.setAutoApproveEdits and is remembered here
 * while this composer stays mounted.
 * Must handle: clicking the plan toggle flips planMode; Shift+Tab reaches the same toggle through
 * the command registry; clicking auto-accept calls setAutoApproveEdits with the opposite state;
 * a failed write shows an error and auto-accept stays off until the sidecar accepts it; a chat
 * config that has not loaded renders nothing; an agent other than Claude, which has no plan mode
 * or accept-edits mode, hides both toggles.
 * Test first: Clicking the plan chip calls sessions.updateConfig with planMode flipped.
 */

import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useLiveShortcut } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { ListTodoIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface ModeChipsProps {
	sessionId: SessionId;
}

/** Plan mode and accept-edits mode are Claude features in this build's runners. */
function supportsModeChips(config: SessionConfig): boolean {
	return config.agent === "claude";
}

const pressedToggle =
	"aria-pressed:rounded-full aria-pressed:bg-primary-fill aria-pressed:text-canvas aria-pressed:hover:opacity-90";

export function ModeChips({ sessionId }: ModeChipsProps) {
	const actions = useActions();
	const { services } = useServices();
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const config = session?.config;
	// The sidecar owns accept-edits mode and the UI has no stored copy, so remember its last
	// successful value per chat while this composer is mounted.
	const [autoAcceptBySession, setAutoAcceptBySession] = useState<Record<string, boolean>>({});
	const autoAccept = autoAcceptBySession[sessionId] ?? false;
	const planShortcut = useLiveShortcut("chat.togglePlanMode");

	const togglePlanMode = (): boolean => {
		const latest = services.sessions.store.getState().sessions[sessionId]?.config;
		if (latest === undefined || !supportsModeChips(latest)) return false;
		void actions.sessions
			.updateConfig(sessionId, { ...latest, planMode: !latest.planMode })
			.then((result) => {
				if (!result.ok) toastError("Couldn't change plan mode", result.error);
			});
		return true;
	};

	useCommandHandler("chat.togglePlanMode", "area", togglePlanMode);

	if (config === undefined || !supportsModeChips(config)) return null;

	const toggleAutoAccept = (): void => {
		const next = !autoAccept;
		void actions.sessions.setAutoApproveEdits(sessionId, next).then((result) => {
			if (!result.ok) {
				toastError("Couldn't change auto-accept edits", result.error);
				return;
			}
			setAutoAcceptBySession((state) => ({ ...state, [sessionId]: next }));
		});
	};

	return (
		<div className="flex items-center gap-1">
			<Tooltip
				content={config.planMode ? "Exit plan mode" : "Plan mode"}
				shortcut={planShortcut ?? undefined}
			>
				<Button
					variant="ghost"
					size="xs"
					aria-label="Plan mode"
					aria-pressed={config.planMode}
					className={pressedToggle}
					onClick={togglePlanMode}
				>
					<ListTodoIcon width={14} height={14} />
				</Button>
			</Tooltip>
			<Tooltip content={autoAccept ? "Disable auto-accept edits" : "Auto-accept edits"}>
				<Button
					variant="ghost"
					size="xs"
					aria-pressed={autoAccept}
					className="h-6 rounded-md px-2 text-xs font-medium aria-pressed:bg-highlight-surface aria-pressed:text-link"
					onClick={toggleAutoAccept}
				>
					Auto-accept edits
				</Button>
			</Tooltip>
		</div>
	);
}
