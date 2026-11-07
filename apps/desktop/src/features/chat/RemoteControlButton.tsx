/**
 * @feature RC-02 Per-chat Remote Control switch and connection status
 * Owns: the chat's Remote Control switch (`useRemoteControlSwitch`, which the composer's "+" menu
 * shows as its "Remote Control" item) and the "Remote Control" chip that shows while it is on, with
 * its popover: the switch, the link's state as the sidecar reports it, and the link to open in
 * Claude or copy.
 * Behaviour: docs/plans/cloud-and-remote.md Part 2 (D019): any Claude chat can be opened in
 * claude.ai/code or the Claude app. Conductor has no such switch, so its place and words are ours,
 * kept few and plain. The switch is the chat's stored `remoteControl` config, changed through
 * sessions.updateConfig, which also starts the agent when it turns on.
 * Must handle: a chat run by another agent (renders nothing); a chat whose config has not loaded
 * (nothing); the switch on with the agent not running yet ("Waiting for the agent"); every link
 * state, with Claude's reason when it failed or is unavailable (an API key, a base URL away from
 * Anthropic); no link yet (no Open or Copy); a failed change, open or status read (an error toast);
 * a chat shown after the app reloaded (its status is asked for once when the switch is on).
 * Test first: choosing Remote Control in the "+" menu calls sessions.updateConfig with remoteControl
 * true, and a connected chat's chip shows "Connected" with Open in Claude and Copy link.
 * Placed in Conductor's layout (D098): Conductor turns a chat's modes on from the composer's "+" menu
 * (Plan mode) and shows a mode that is on as a chip beside the model picker ("Auto-accept edits",
 * renderApp @8916916). Remote Control follows both: its switch is a "+" item, and while it is on a
 * 24px chip in the link fill with a globe and a dot for the link (success while ready or connected,
 * danger when it failed or is unavailable) opens the status popover.
 */
import type { RemoteControlStatus } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { cn } from "../../ui/cn.ts";
import { GlobeIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { toastError } from "../../ui/Toast.tsx";

const STATE_LABELS: Readonly<Record<RemoteControlStatus["state"], string>> = {
	off: "Waiting for the agent",
	connecting: "Connecting",
	ready: "Ready",
	connected: "Connected",
	reconnecting: "Reconnecting",
	disconnected: "Disconnected",
	failed: "Couldn't connect",
	unavailable: "Not available",
};

function dotClass(state: RemoteControlStatus["state"]): string {
	if (state === "ready" || state === "connected") return "bg-success";
	if (state === "failed" || state === "unavailable") return "bg-danger";
	return "bg-fg-subtle";
}

const OFF: RemoteControlStatus = { state: "off" };

/** Whether a chat offers Remote Control, whether it is on, and the change through its config. */
export function useRemoteControlSwitch(sessionId: SessionId): {
	offered: boolean;
	on: boolean;
	setOn: (next: boolean) => void;
} {
	const actions = useActions();
	const { services } = useServices();
	const config = useStore(services.sessions.store, (state) => state.sessions[sessionId]?.config);
	const setOn = (next: boolean): void => {
		const latest = services.sessions.store.getState().sessions[sessionId]?.config;
		if (latest === undefined) return;
		void actions.sessions
			.updateConfig(sessionId, { ...latest, remoteControl: next })
			.then((result) => {
				if (!result.ok) toastError("Couldn't change Remote Control", result.error);
			});
	};
	return {
		offered: config?.agent === "claude",
		on: config?.agent === "claude" && config.remoteControl === true,
		setOn,
	};
}

export function RemoteControlButton({ sessionId }: { sessionId: SessionId }) {
	const actions = useActions();
	const { services } = useServices();
	const status = useStore(
		services.sessions.store,
		(state) => state.remoteControl?.[sessionId] ?? OFF,
	);
	const { offered: isClaude, on, setOn } = useRemoteControlSwitch(sessionId);

	// After a reload the store has no link; the sidecar may still hold one.
	useEffect(() => {
		if (!isClaude || !on) return;
		void services.sessions.refreshRemoteControl(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't read the Remote Control status", result.error);
		});
	}, [services, sessionId, isClaude, on]);

	if (!on) return null;

	const link = status.sessionUrl;

	return (
		<Popover
			side="top"
			align="start"
			className="w-72"
			trigger={
				<button
					type="button"
					className="flex h-6 items-center gap-1.5 rounded-md bg-highlight-surface px-2 py-0.5 text-link transition-colors hover:opacity-80"
				>
					<GlobeIcon className="size-3.5 shrink-0" />
					<span className="text-xs font-medium whitespace-nowrap">Remote Control</span>
					<span
						aria-hidden="true"
						className={cn("size-1.5 shrink-0 rounded-full", dotClass(status.state))}
					/>
				</button>
			}
		>
			<div className="flex flex-col gap-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<p className="font-medium text-fg">Remote Control</p>
						<p className="text-xs text-fg-muted">
							Follow and steer this chat from claude.ai/code or the Claude app while it runs here.
						</p>
					</div>
					<Switch checked={on} onCheckedChange={setOn} aria-label="Remote Control" />
				</div>
				<div className="flex flex-col gap-1" role="status">
					<p className="flex items-center gap-2 text-xs font-medium text-fg">
						<span
							aria-hidden="true"
							className={cn("size-2 rounded-full", dotClass(status.state))}
						/>
						{STATE_LABELS[status.state]}
					</p>
					{status.detail === undefined ? null : (
						<p className="text-xs text-fg-muted">{status.detail}</p>
					)}
				</div>
				{link === undefined ? null : (
					<div className="flex items-center gap-1">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								void actions.app.openUrl(link).then((result) => {
									if (!result.ok) toastError("Couldn't open the link", result.error);
								});
							}}
						>
							Open in Claude
						</Button>
						<CopyButton
							text={link}
							label="Copy link"
							onCopy={(text) => actions.app.copyText(text)}
						/>
					</div>
				)}
			</div>
		</Popover>
	);
}
