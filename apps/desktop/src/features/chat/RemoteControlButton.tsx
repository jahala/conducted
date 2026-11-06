/**
 * @feature RC-02 Per-chat Remote Control switch and connection status
 * Owns: the Remote Control button in a Claude chat's composer toolbar and its popover: the chat's
 * switch, the link's state as the sidecar reports it, and the link to open in Claude or copy.
 * Behaviour: docs/plans/cloud-and-remote.md Part 2 (D019): any Claude chat can be opened in
 * claude.ai/code or the Claude app. Conductor has no such switch, so its place and words are ours,
 * kept few and plain. The switch is the chat's stored `remoteControl` config, changed through
 * sessions.updateConfig, which also starts the agent when it turns on.
 * Must handle: a chat run by another agent (renders nothing); a chat whose config has not loaded
 * (nothing); the switch on with the agent not running yet ("Waiting for the agent"); every link
 * state, with Claude's reason when it failed or is unavailable (an API key, a base URL away from
 * Anthropic); no link yet (no Open or Copy); a failed change, open or status read (an error toast);
 * a chat shown after the app reloaded (its status is asked for once when the switch is on).
 * Test first: turning the switch on calls sessions.updateConfig with remoteControl true, and a
 * connected chat shows "Connected" with Open in Claude and Copy link.
 * Our design choice: a globe button beside the context wheel, filled while the switch is on, with a
 * dot for the link: success while ready or connected, danger when it failed or is unavailable.
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

export function RemoteControlButton({ sessionId }: { sessionId: SessionId }) {
	const actions = useActions();
	const { services } = useServices();
	const config = useStore(services.sessions.store, (state) => state.sessions[sessionId]?.config);
	const status = useStore(
		services.sessions.store,
		(state) => state.remoteControl?.[sessionId] ?? OFF,
	);
	const isClaude = config?.agent === "claude";
	const on = config?.remoteControl === true;

	// After a reload the store has no link; the sidecar may still hold one.
	useEffect(() => {
		if (!isClaude || !on) return;
		void services.sessions.refreshRemoteControl(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't read the Remote Control status", result.error);
		});
	}, [services, sessionId, isClaude, on]);

	if (config === undefined || !isClaude) return null;

	const setOn = (next: boolean): void => {
		const latest = services.sessions.store.getState().sessions[sessionId]?.config;
		if (latest === undefined) return;
		void actions.sessions
			.updateConfig(sessionId, { ...latest, remoteControl: next })
			.then((result) => {
				if (!result.ok) toastError("Couldn't change Remote Control", result.error);
			});
	};

	const link = on ? status.sessionUrl : undefined;

	return (
		<Popover
			side="top"
			align="end"
			className="w-72"
			trigger={
				<Button
					variant="ghost"
					size="xs"
					aria-label="Remote Control"
					aria-pressed={on}
					className="relative aria-pressed:rounded-full aria-pressed:bg-primary-fill aria-pressed:text-canvas"
				>
					<GlobeIcon width={14} height={14} />
					{on ? (
						<span
							aria-hidden="true"
							className={cn(
								"absolute right-0.5 top-0.5 size-1.5 rounded-full",
								dotClass(status.state),
							)}
						/>
					) : null}
				</Button>
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
				{on ? (
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
				) : null}
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
