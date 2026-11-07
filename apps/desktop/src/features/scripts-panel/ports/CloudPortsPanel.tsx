/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the Ports tab of a cloud workspace: Start forwarding (Cmd+Y), Waiting for ports, and the
 * Forward ports popover with detected ports, forwarded ports (each moveable up or down), a typed
 * remote port, per-forward toggles, Auto-forwarding and a shareable preview URL.
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
import { ArrowDownIcon, ArrowUpIcon } from "../../../ui/icons.tsx";
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

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<div className="flex items-center justify-between gap-3 border-b border-separator px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm text-fg">Cloud ports</span>
					{view.forwardingEnabled ? <Badge>Forwarding ports</Badge> : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Popover
						trigger={
							<Button variant="outline" size="xs">
								Forward ports
							</Button>
						}
						align="end"
					>
						<div className="flex w-80 flex-col gap-3">
							<p className="text-xs text-fg-muted">
								Select a port to share via a URL. Workspace read permissions required.
							</p>
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
							<section className="flex flex-col gap-1">
								<p className="text-xs font-medium text-fg">Forwarded ports</p>
								{view.forwards.length === 0 ? (
									<p className="text-xs text-fg-subtle">Nothing is forwarded yet.</p>
								) : (
									view.forwards.map((forward, index) => (
										<div key={forward.id} className="flex flex-col gap-1">
											<div className="flex items-center justify-between gap-2">
												<span className="font-mono text-sm text-fg">
													localhost:{forward.localPort} → {forward.remotePort}
												</span>
												<div className="flex items-center gap-0.5">
													<IconButton
														size="xs"
														variant="ghost"
														label="Move forwarded port up"
														icon={<ArrowUpIcon className="size-3.5" />}
														disabled={index === 0}
														onClick={() =>
															void actions.portForwards.move(forward.id, "up").then((result) => {
																if (!result.ok) {
																	toastError("Couldn't move the forward", result.error);
																}
															})
														}
													/>
													<IconButton
														size="xs"
														variant="ghost"
														label="Move forwarded port down"
														icon={<ArrowDownIcon className="size-3.5" />}
														disabled={index === view.forwards.length - 1}
														onClick={() =>
															void actions.portForwards.move(forward.id, "down").then((result) => {
																if (!result.ok) {
																	toastError("Couldn't move the forward", result.error);
																}
															})
														}
													/>
												</div>
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
												<Button
													variant="ghost"
													size="xs"
													onClick={() => copyPreview(forward.remotePort)}
												>
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
									))
								)}
							</section>
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
