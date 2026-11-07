/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the cloud part of the workspace header: the "Conductor Cloud" badge, the sandbox's status,
 * its CPU, memory and disk meters, the "Low disk" warning, the workspace's agent cost, and the
 * Restart button that reports "Restarted workspace".
 * Behaviour: ui-map.md 3.1 (the cloud header's badge, Status, CPU, Memory, Disk, "Low disk",
 * "Agent cost" and Restart) and the inventory's toast "Restarted workspace". Conductor gets the
 * status and meters from its hosted backend's `remoteState`; ours come from the sandbox through
 * the Worker (D116). The cost is the sum of the usage each agent turn reported (CHAT-14), shown
 * only while "Show agent cost" is on, as Conductor does.
 * Must handle: a local workspace (nothing); a stopped sandbox (no meters); the first reading (CPU
 * has no percentage yet); a Worker failure (the status says "Unavailable" with the error on hover);
 * a restart in flight (the button is disabled and says "Starting..."); a failed restart (its own
 * toast, never "Restarted workspace"); a nearly full disk ("Low disk" and the space left).
 * Our design choice: the strip is compact enough for the header row and each meter carries its
 * full value in its tooltip. Conductor shows these in a hover card; the checklist asks for the
 * header itself, so the values are visible without opening one (D116).
 * Test first: a running workspace shows its badge, status and meters, and Restart reports
 * "Restarted workspace".
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import type { CloudWorkspaceView } from "../../core/api.ts";
import { useActions, useCloudWorkspace, useSetting, useWorkspace } from "../../core/hooks.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { CloudIcon, RefreshIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError, workspaceToast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

/** Conductor's low-disk mark: 512 MiB left or less (`Zmo` in renderApp). */
export const LOW_DISK_BYTES = 512 * 1024 ** 2;

/** Bytes as Conductor writes them: whole GB when exact, otherwise one decimal, never KB. */
export function formatBytes(bytes: number): string {
	const mebibytes = bytes / 1024 / 1024;
	if (mebibytes < 1024) {
		return `${Number.isInteger(mebibytes) ? mebibytes.toFixed(0) : mebibytes.toFixed(1)} MB`;
	}
	const gibibytes = mebibytes / 1024;
	return `${Number.isInteger(gibibytes) ? gibibytes.toFixed(0) : gibibytes.toFixed(1)} GB`;
}

/** A share as Conductor writes it: one decimal and a percent sign. */
export function formatPercent(percent: number): string {
	return `${percent.toFixed(1)}%`;
}

/** The instance's cores as Conductor writes them: "1 core" or "0.3 cores". */
export function formatCores(cores: number): string {
	if (cores === 1) return "1 core";
	return `${Number.isInteger(cores) ? cores.toString() : cores.toFixed(1)} cores`;
}

/** The cost as Conductor writes it: two decimal places and a dollar sign. */
export function formatCost(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

function statusWord(view: CloudWorkspaceView, restarting: boolean): string {
	if (restarting) return "Starting";
	switch (view.status) {
		case "running":
			return "Running";
		case "stopped":
			return "Stopped";
		default:
			return view.error === null ? "Unknown" : "Unavailable";
	}
}

function statusDot(view: CloudWorkspaceView, restarting: boolean): string {
	if (restarting) return "bg-status-progress";
	switch (view.status) {
		case "running":
			return "bg-success";
		case "stopped":
			return "bg-fg-subtle";
		default:
			return view.error === null ? "bg-fg-subtle" : "bg-danger";
	}
}

export interface CloudWorkspaceStatusProps {
	workspaceId: WorkspaceId;
	/** True while the workspace is not ready, when Conductor disables Restart (`mKe`). */
	restartDisabled?: boolean;
}

export function CloudWorkspaceStatus({
	workspaceId,
	restartDisabled = false,
}: CloudWorkspaceStatusProps) {
	const workspace = useWorkspace(workspaceId);
	const view = useCloudWorkspace(workspaceId);
	const actions = useActions();
	const showCost = useSetting<boolean>("experimental_show_agent_cost") === true;
	const [restarting, setRestarting] = useState(false);

	if (workspace.state !== "ready" || workspace.data.host.kind !== "cloud") return null;

	const restart = () => {
		if (restarting || restartDisabled) return;
		setRestarting(true);
		void actions.workspaces.restart(workspaceId).then(async (result) => {
			setRestarting(false);
			if (!result.ok) {
				toastError("Couldn't restart the workspace", result.error);
				return;
			}
			workspaceToast(workspaceId, "Restarted workspace");
		});
	};

	const { cpu, memory, disk } = view.resources;
	const lowDisk = disk !== null && disk.availableBytes <= LOW_DISK_BYTES;
	const cost =
		showCost && view.agentCostUsd !== null && view.agentCostUsd > 0 ? view.agentCostUsd : null;
	const word = statusWord(view, restarting);

	return (
		<div className="flex min-w-0 shrink items-center gap-2">
			<span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs text-fg-muted">
				<CloudIcon className="size-3" />
				Conductor Cloud
			</span>
			<span
				className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted"
				title={view.error ?? undefined}
			>
				<span
					aria-hidden="true"
					className={`size-1.5 rounded-full ${statusDot(view, restarting)}`}
				/>
				{word}
			</span>
			{cpu === null ? null : (
				<Tooltip
					content={
						cpu.capacityCores === null
							? "The instance's CPU limit is unknown."
							: `${formatCores(cpu.capacityCores)} · ${cpu.usedPercent === null ? "measuring" : `${formatPercent(cpu.usedPercent)} used`}`
					}
				>
					<span className="shrink-0 text-xs text-fg-subtle">
						CPU {cpu.usedPercent === null ? "—" : formatPercent(cpu.usedPercent)}
					</span>
				</Tooltip>
			)}
			{memory === null ? null : (
				<Tooltip
					content={`${formatBytes(memory.totalBytes)} · ${formatPercent(memory.usedPercent)} used`}
				>
					<span className="shrink-0 text-xs text-fg-subtle">
						Memory {formatPercent(memory.usedPercent)}
					</span>
				</Tooltip>
			)}
			{disk === null ? null : (
				<Tooltip
					content={`${formatBytes(disk.totalBytes)} · ${formatPercent(disk.usedPercent)} used`}
				>
					<span
						className={
							lowDisk ? "shrink-0 text-xs text-warning" : "shrink-0 text-xs text-fg-subtle"
						}
					>
						{disk.availableBytes === 0
							? "Disk full"
							: lowDisk
								? `Disk ${formatBytes(disk.availableBytes)} left`
								: `Disk ${formatPercent(disk.usedPercent)}`}
					</span>
				</Tooltip>
			)}
			{lowDisk ? <Badge tone="warning">Low disk</Badge> : null}
			{cost === null ? null : (
				<span className="shrink-0 text-xs text-fg-subtle">Agent cost {formatCost(cost)}</span>
			)}
			<Button
				variant="ghost"
				size="xs"
				className="shrink-0 text-fg-muted hover:text-fg"
				disabled={restarting || restartDisabled}
				title={restarting ? "Starting workspace" : "Restart workspace"}
				aria-label={restarting ? "Starting workspace" : "Restart workspace"}
				onClick={restart}
			>
				{restarting ? (
					<Spinner label="Starting workspace" size="sm" />
				) : (
					<RefreshIcon className="size-3" />
				)}
				<span>{restarting ? "Starting..." : "Restart"}</span>
			</Button>
		</div>
	);
}
