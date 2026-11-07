/**
 * @feature COMP-03 Plan mode and approval toggles
 * Owns: the chat's plan mode command (Shift+Tab and the "+" menu's "Plan mode") and the
 * "Auto-accept edits" chip that shows while a Claude chat accepts edits without asking.
 * Behaviour: ui-map.md 3.5 (the 'Auto-accept edits' chip with the tooltip 'Disable auto-accept
 * edits', and plan mode with Shift+Tab), 5.4 (Shift+Tab while typing), claude-runner.md 3.
 * Measured from Conductor 0.92.1: plan mode lives in the "+" menu (renderApp @8907795), and the
 * auto-accept chip shows only while it is on, beside the model picker (AQo, @8916916): a 24px chip
 * in the link fill and colour with a fast-forward mark; a click turns it off. It turns on from the
 * approval card's "Allow all edits during this session" (@9294092). Neither has a toggle of its own
 * in the composer's row (D098).
 * Our design choice: plan mode is the chat's stored `planMode`, so it goes through
 * sessions.updateConfig. Auto-accept edits is Claude's live accept-edits mode, which the stored
 * config does not hold; the sessions store keeps whether it is on.
 * Must handle: Shift+Tab and the "+" menu reach the same command, which flips planMode; a failed
 * write shows an error and the chip stays; a chat config that has not loaded renders nothing; an
 * agent other than Claude, which has no plan mode or accept-edits mode, shows no chip and its
 * command explains.
 * Test first: Choosing Plan mode in the "+" menu calls sessions.updateConfig with planMode flipped.
 */

import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { FastForwardIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface ModeChipsProps {
	sessionId: SessionId;
}

/** Plan mode and accept-edits mode are Claude features in this build's runners. */
function supportsModeChips(config: SessionConfig): boolean {
	return config.agent === "claude";
}

export function ModeChips({ sessionId }: ModeChipsProps) {
	const actions = useActions();
	const { services } = useServices();
	const config = useStore(services.sessions.store, (state) => state.sessions[sessionId]?.config);
	const autoAccept = useStore(
		services.sessions.store,
		(state) => state.autoAcceptEdits?.[sessionId] === true,
	);

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

	if (config === undefined || !supportsModeChips(config) || !autoAccept) return null;

	const disableAutoAccept = (): void => {
		void actions.sessions.setAutoApproveEdits(sessionId, false).then((result) => {
			if (!result.ok) toastError("Couldn't change auto-accept edits", result.error);
		});
	};

	return (
		<Tooltip content="Disable auto-accept edits">
			<button
				type="button"
				onClick={disableAutoAccept}
				className="flex h-6 items-center rounded-md bg-highlight-surface px-2 py-0.5 text-link transition-colors hover:opacity-80"
			>
				<FastForwardIcon className="size-4 shrink-0" />
				<span className="pl-1.5 text-xs font-medium whitespace-nowrap">Auto-accept edits</span>
			</button>
		</Tooltip>
	);
}
