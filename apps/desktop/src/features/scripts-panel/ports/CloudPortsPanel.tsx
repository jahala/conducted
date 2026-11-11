/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the Ports tab of a cloud workspace: Start forwarding (Cmd+Y), Waiting for ports, the
 * Preview URL row that shares one port as a capability URL (CLOUD-09), and the Forward ports
 * popover with detected ports, forwarded ports, a typed remote port, per-forward toggles and
 * Auto-forwarding.
 * Behaviour: ui-map.md 3.7 (the popover's labels and the Start forwarding button), 6 (the
 * Connections settings that this view obeys), services-map.md 5A.3.3 (forward, toggle, cancel and
 * discovery). Messages are Conductor's: "Enter a valid port (1-65535)", "Port 22 is reserved for
 * SSH and cannot be forwarded here" and "Forwarding ports".
 * Must handle: a workspace with nothing detected yet (the Waiting state), an error from the
 * service (shown above the controls), a typed port that is not a number (the same message), and a
 * forward the sandbox no longer listens on (listed under Ports unavailable).
 * Test first: a cloud workspace with two detected ports lists both and forwards nothing until a
 * port is chosen.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../../core/context.tsx";
import {
	useActions,
	useLiveShortcut,
	usePortForwards,
	useSetting,
	useWorkspace,
} from "../../../core/hooks.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Input } from "../../../ui/Input.tsx";
import { CopyIcon } from "../../../ui/icons.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { useUrlOpeners } from "../open-url.ts";
import { forwardingToast } from "./forwarding-toast.ts";

export interface CloudPortsPanelProps {
	workspaceId: WorkspaceId;
}

const localhostUrl = (port: number): string => `http://localhost:${port}`;

export function CloudPortsPanel({ workspaceId }: CloudPortsPanelProps) {
	const actions = useActions();
	const services = useServices().services;
	const workspace = useWorkspace(workspaceId);
	const view = usePortForwards(workspaceId);
	const open = useUrlOpeners(workspaceId);
	const shortcut = useLiveShortcut("workspace.togglePortForwarding");
	const exclusive = useSetting<boolean>("exclusive_port_forwarding_enabled") === true;
	const [typed, setTyped] = useState("");
	/** The port shared as a preview URL, or null while the row reads "Off" (CLOUD-09). */
	const [previewPort, setPreviewPort] = useState<number | null>(null);

	if (workspace.state === "loading") return null;
	if (workspace.state === "error") {
		return (
			<EmptyState title="Ports are unavailable" body={workspace.error.message} tone="failed" />
		);
	}
	if (workspace.data.host.kind !== "cloud") return null;

	const setForwarding = (enabled: boolean) => {
		void (async () => {
			const result = await actions.portForwards.setForwarding(workspaceId, enabled);
			if (!result.ok) {
				toastError("Couldn't change port forwarding", result.error);
				return;
			}
			if (!enabled) return;
			const message = forwardingToast(services.portForwards.view(workspaceId));
			if (message !== null) {
				toast.success(message.title, { description: message.description });
			}
		})();
	};

	const add = () => {
		const port = Number(typed);
		void (async () => {
			const result = await actions.portForwards.add(workspaceId, port);
			if (!result.ok) {
				toastError("Couldn't forward the port", result.error);
				return;
			}
			setTyped("");
			toast(`Forwarding port ${port}`);
		})();
	};

	const copyPreview = (remotePort: number) => {
		void (async () => {
			const result = await actions.portForwards.previewUrl(workspaceId, remotePort);
			if (!result.ok) {
				toastError("Couldn't make a preview URL", result.error);
				return;
			}
			const copied = await actions.app.copyText(result.value);
			if (!copied.ok) toastError("Couldn't copy the URL", copied.error);
			else toast("Preview URL copied");
		})();
	};

	const detected = view.detectedPorts.filter(
		(entry) => !view.forwards.some((forward) => forward.remotePort === entry.port),
	);
	const unavailable = view.forwards.filter(
		(forward) => !view.detectedPorts.some((entry) => entry.port === forward.remotePort),
	);
	// Conductor offers the ports it is forwarding and the ones it has detected, in numeric order.
	const previewCandidates = [
		...new Set([
			...view.forwards.filter((forward) => forward.enabled).map((forward) => forward.remotePort),
			...view.detectedPorts.map((entry) => entry.port),
		]),
	].sort((left, right) => left - right);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<div className="flex flex-col gap-2 border-b border-separator px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					{view.forwardingEnabled ? <Badge>Forwarding ports</Badge> : null}
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-2 [&>*]:shrink-0">
					<Popover
						trigger={
							<Button variant="outline" size="xs">
								Forward ports
							</Button>
						}
						align="end"
					>
						<div className="flex w-80 flex-col gap-3">
							<section className="flex flex-col gap-1">
								<p className="text-xs font-medium text-fg">Ports detected</p>
								{detected.length === 0 ? (
									<p className="text-xs text-fg-subtle">No new ports detected.</p>
								) : (
									detected.map((entry) => (
										<div
											key={entry.port}
											className="flex items-center justify-between gap-2 text-sm text-fg"
										>
											<span className="min-w-0 truncate font-mono">
												localhost:{entry.port}
												{entry.processName === null ? null : (
													<span className="ml-1 font-sans text-fg-muted">{entry.processName}</span>
												)}
											</span>
											<Button
												variant="ghost"
												size="xs"
												onClick={() =>
													void actions.portForwards.add(workspaceId, entry.port).then((result) => {
														if (!result.ok) {
															toastError("Couldn't forward the port", result.error);
														}
													})
												}
											>
												Forward port
											</Button>
										</div>
									))
								)}
							</section>
							{unavailable.length === 0 ? null : (
								<section className="flex flex-col gap-1">
									<p className="text-xs font-medium text-fg">Ports unavailable</p>
									{unavailable.map((forward) => (
										<div
											key={forward.id}
											className="flex items-center justify-between gap-2 text-sm text-fg-muted"
										>
											<span className="font-mono">
												localhost:{forward.localPort} → {forward.remotePort}
											</span>
											<Button
												variant="ghost"
												size="xs"
												onClick={() =>
													void actions.portForwards.remove(forward.id).then((result) => {
														if (!result.ok) {
															toastError("Couldn't cancel the forward", result.error);
														}
													})
												}
											>
												Cancel forwarding port
											</Button>
										</div>
									))}
								</section>
							)}
							<section className="flex items-center gap-2">
								<Input
									type="number"
									min={1}
									max={65_535}
									value={typed}
									placeholder="Remote port"
									aria-label="Remote port"
									className="w-32"
									onChange={(event) => setTyped(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") add();
									}}
								/>
								<Button variant="secondary" size="xs" onClick={add}>
									Add port
								</Button>
							</section>
							<div className="flex items-center justify-between gap-2 text-sm text-fg">
								<span>Auto-forwarding</span>
								<Switch
									checked={view.autoForwardEnabled}
									aria-label="Auto-forwarding"
									onCheckedChange={(checked) =>
										void actions.portForwards
											.setAutoForward(workspaceId, checked)
											.then((result) => {
												if (!result.ok) {
													toastError("Couldn't change auto-forwarding", result.error);
												}
											})
									}
								/>
							</div>
						</div>
					</Popover>
					<Button
						variant={view.forwardingEnabled ? "outline" : "default"}
						size="xs"
						onClick={() => setForwarding(!view.forwardingEnabled)}
					>
						<span className="inline-flex items-center gap-1.5">
							{view.forwardingEnabled ? "Pause forwarding" : "Start forwarding"}
							{shortcut === null ? null : <Kbd>{shortcut}</Kbd>}
						</span>
					</Button>
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 border-b border-separator px-3 py-2">
				<span className="text-sm text-fg" title="Preview URL">
					Preview URL
				</span>
				<div className="flex items-center gap-1">
					<Popover
						trigger={
							<Button variant="ghost" size="xs" aria-label="Choose preview URL port">
								{previewPort === null ? "Off" : String(previewPort)}
							</Button>
						}
						align="end"
					>
						<div className="flex w-64 flex-col gap-1">
							<p className="px-2 py-1.5 text-xs text-fg-muted">
								Select a port to share via a URL. Workspace read permissions required.
							</p>
							<button
								type="button"
								className="flex items-center rounded-md px-2 py-1 text-left text-sm text-fg hover:bg-hover"
								onClick={() => setPreviewPort(null)}
							>
								Off
							</button>
							{previewCandidates.map((port) => (
								<button
									key={port}
									type="button"
									className="flex items-center rounded-md px-2 py-1 text-left text-sm tabular-nums text-fg hover:bg-hover"
									onClick={() => setPreviewPort(port)}
								>
									{port}
								</button>
							))}
						</div>
					</Popover>
					{previewPort === null ? null : (
						<IconButton
							size="xs"
							label="Copy preview URL"
							title="Copy preview URL"
							icon={<CopyIcon className="size-3.5" />}
							onClick={() => copyPreview(previewPort)}
						/>
					)}
				</div>
			</div>
			{view.error === null ? null : (
				<p role="alert" className="px-3 py-2 text-xs text-danger">
					{view.error}
				</p>
			)}
			{exclusive ? (
				<p className="px-3 py-2 text-xs text-fg-subtle">
					Exclusive port forwarding is on, so turning this on stops forwarding elsewhere.
				</p>
			) : null}
			{view.forwardingEnabled && view.waiting ? (
				<div className="flex flex-1 items-center justify-center px-3 py-8">
					<EmptyState title="Waiting for ports" body="Start a server in the cloud workspace." />
				</div>
			) : null}
			{view.forwards.length === 0 ? null : (
				<section className="flex flex-col gap-1">
					<p className="text-xs font-medium text-fg">Forwarded ports</p>
					{view.forwards.map((forward) => (
						<div key={forward.id} className="flex flex-col gap-1">
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-sm text-fg">
									localhost:{forward.localPort} → {forward.remotePort}
								</span>
								<Switch
									checked={forward.enabled}
									aria-label={`Forward remote port ${forward.remotePort}`}
									onCheckedChange={(checked) =>
										void actions.portForwards.toggle(forward.id, checked).then((result) => {
											if (!result.ok) {
												toastError("Couldn't toggle the forward", result.error);
											}
										})
									}
								/>
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="xs"
									title={localhostUrl(forward.localPort)}
									onClick={() => open.inBrowser(localhostUrl(forward.localPort))}
								>
									Forward to localhost
								</Button>
								<Button variant="ghost" size="xs" onClick={() => copyPreview(forward.remotePort)}>
									Copy preview URL
								</Button>
								<Button
									variant="ghost"
									size="xs"
									onClick={() =>
										void actions.portForwards.remove(forward.id).then((result) => {
											if (!result.ok) {
												toastError("Couldn't cancel the forward", result.error);
											}
										})
									}
								>
									Cancel forwarding port
								</Button>
							</div>
						</div>
					))}
				</section>
			)}

			{view.forwards.length === 0 && !(view.forwardingEnabled && view.waiting) ? (
				<div className="flex flex-1 items-center justify-center px-3 py-8">
					<EmptyState
						title="No ports forwarded"
						body="Open Forward ports to choose a port from the cloud workspace."
					/>
				</div>
			) : null}
		</div>
	);
}
