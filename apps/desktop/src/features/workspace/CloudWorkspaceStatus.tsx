/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: a cloud workspace's header control and its popover: the trigger is the workspace's
 * identity (status icon, display name, "Low disk"), and the popover holds the name with the
 * app's rename and workspace-actions controls, a separator, then the labelled rows Environment,
 * Status, CPU, Memory, Disk and Agent cost, with Restart.
 * Behaviour: ui-map.md 3.1 and Conductor's cloud header (renderApp `a2o`, `NPi`, `Xgo`, `Zgo`),
 * read for structure only (D001): the trigger is one button, `aria-label` "<name> · <status>"
 * plus " · Low disk space" when low; the popover is 320px wide, scrolls, and starts with the
 * identity. The Environment row says "Cloudflare" because our cloud is the user's own Cloudflare
 * account, not Conductor's brand. Conductor gets its status and meters from its hosted backend;
 * ours come from the sandbox through the Worker (D116). The cost is the sum of the usage each
 * agent turn reported (CHAT-14), shown only while "Show agent cost" is on.
 * Must handle: a local workspace (nothing); a stopped sandbox (no meters); the first reading (CPU
 * has no percentage yet); a Worker failure ("Unavailable" with the error on hover); a restart in
 * flight (the button is disabled and says "Starting..."); a failed restart (its own toast, never
 * "Restarted workspace"); a nearly full disk ("Low disk" on the trigger and the space left in the
 * Disk row); an archived workspace (no rename, restart disabled).
 * Our design choice: the identity uses the app's rename dialog and the workspace actions menu it
 * already has. Conductor's repository, created, setup and workspace-id rows are left out because
 * they belong to other features and are not in this checklist. The low-disk warning box below the
 * rows is left out; the trigger's "Low disk" and the Disk row carry the warning.
 * Test first: the trigger opens a popover with the identity and the labelled rows, and Restart
 * reports "Restarted workspace".
 */
import type { WorkspaceId } from "@conducted/shared";
import { type MouseEvent, type ReactNode, useState } from "react";
import type { CloudWorkspaceView } from "../../core/api.ts";
import { useActions, useCloudWorkspace, useSetting, useWorkspace } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import {
	AlertCircleIcon,
	CircleIcon,
	CloudIcon,
	CoinIcon,
	CpuIcon,
	DatabaseIcon,
	HardDriveIcon,
	InfoIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RefreshIcon,
} from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Separator } from "../../ui/Separator.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError, workspaceToast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useBranchPrefix } from "./use-branch-prefix.ts";
import { WorkspaceActionsMenu } from "./WorkspaceActionsMenu.tsx";
import { WorkspaceRenameDialog } from "./WorkspaceRenameDialog.tsx";
import { workspaceName } from "./workspace-name.ts";

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

type StatusState = "live" | "loading" | "failed" | "done";

function statusState(view: CloudWorkspaceView, restarting: boolean): StatusState {
	if (restarting) return "loading";
	switch (view.status) {
		case "running":
			return "live";
		case "stopped":
			return "done";
		default:
			return view.error === null ? "done" : "failed";
	}
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

/** Conductor's `pH` in our icons: a spinner, an alert, a live dot, or a muted circle. */
function CloudStatusIcon({ state }: { state: StatusState }) {
	return (
		<span className="flex size-3.5 shrink-0 items-center justify-center">
			{state === "loading" ? (
				<Spinner label="Connecting" size="sm" />
			) : state === "failed" ? (
				<AlertCircleIcon className="size-3.5 text-danger" />
			) : state === "live" ? (
				<span aria-hidden="true" className="size-2 rounded-full bg-success" />
			) : (
				<CircleIcon className="size-3.5 text-fg-subtle" />
			)}
		</span>
	);
}

/** One labelled row of the popover (`zL` in Conductor): icon, muted label, value at the right. */
function DetailRow({
	icon,
	label,
	children,
	trailing,
	valueClass = "ml-auto min-w-0 truncate text-right text-fg",
}: {
	icon: ReactNode;
	label: string;
	children: ReactNode;
	trailing?: ReactNode;
	valueClass?: string;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2 text-xs">
			<span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">{icon}</span>
			<span className="shrink-0 text-fg-muted">{label}</span>
			<span className={valueClass}>{children}</span>
			{trailing}
		</div>
	);
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
	const branchPrefix = useBranchPrefix();
	const showCost = useSetting<boolean>("experimental_show_agent_cost") === true;
	const [restarting, setRestarting] = useState(false);
	const [renaming, setRenaming] = useState(false);

	if (workspace.state !== "ready" || workspace.data.host.kind !== "cloud") return null;

	const data = workspace.data;
	const name = workspaceName(data, branchPrefix);
	const archived = data.state === "archived" || data.state === "archiving";
	const state = statusState(view, restarting);
	const word = statusWord(view, restarting);
	const { cpu, memory, disk } = view.resources;
	const lowDisk = disk !== null && disk.availableBytes <= LOW_DISK_BYTES;
	const cost =
		showCost && view.agentCostUsd !== null && view.agentCostUsd > 0 ? view.agentCostUsd : null;
	const ariaLabel = `${name || "Workspace"} · ${word}${lowDisk ? " · Low disk space" : ""}`;

	const restart = () => {
		if (restarting || restartDisabled) return;
		setRestarting(true);
		void actions.workspaces.restart(workspaceId).then((result) => {
			setRestarting(false);
			if (!result.ok) {
				toastError("Couldn't restart the workspace", result.error);
				return;
			}
			workspaceToast(workspaceId, "Restarted workspace");
		});
	};

	const openActionsMenu = (event: MouseEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		event.currentTarget.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: rect.left,
				clientY: rect.top,
			}),
		);
	};

	const trigger = (
		<button
			type="button"
			aria-label={ariaLabel}
			className="mx-1 flex h-6 min-w-0 items-center rounded-sm px-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
		>
			<CloudStatusIcon state={state} />
			<span className="ml-1.5 min-w-0 max-w-64 truncate text-sm font-medium">{name}</span>
			{lowDisk ? (
				<span className="ml-1.5 shrink-0 text-xs font-medium text-warning">Low disk</span>
			) : null}
		</button>
	);

	return (
		<>
			<Popover
				trigger={trigger}
				align="start"
				side="bottom"
				className="w-80 max-h-[560px] overflow-y-auto"
			>
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-1">
						<div className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
							{name}
						</div>
						{archived ? null : (
							<IconButton
								label="Rename workspace"
								size="xs"
								icon={<PencilIcon className="size-3" />}
								onClick={() => setRenaming(true)}
							/>
						)}
						<WorkspaceActionsMenu workspaceId={workspaceId}>
							<button
								type="button"
								aria-label="Workspace actions"
								title="Workspace actions"
								className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
								onClick={openActionsMenu}
							>
								<MoreHorizontalIcon className="size-3.5" />
							</button>
						</WorkspaceActionsMenu>
					</div>

					<Separator />

					<div className="flex flex-col gap-2">
						<DetailRow icon={<CloudIcon className="size-3.5" />} label="Environment">
							<span className="text-fg-muted">Cloudflare</span>
						</DetailRow>
						<DetailRow
							icon={<CircleIcon className="size-3.5" />}
							label="Status"
							valueClass="ml-auto flex min-w-0 items-center gap-1"
						>
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
							{restarting ? null : (
								<span className="inline-flex min-w-0 items-center gap-1.5">
									<CloudStatusIcon state={state} />
									<span className="min-w-0 truncate">{word}</span>
								</span>
							)}
						</DetailRow>

						{cpu === null ? null : (
							<DetailRow icon={<CpuIcon className="size-3.5" />} label="CPU">
								<span className="text-fg-muted">
									{cpu.capacityCores === null ? "Unknown" : formatCores(cpu.capacityCores)}
								</span>
								{cpu.usedPercent === null ? null : ` · ${formatPercent(cpu.usedPercent)} used`}
							</DetailRow>
						)}
						{memory === null ? null : (
							<DetailRow icon={<DatabaseIcon className="size-3.5" />} label="Memory">
								<span className="text-fg-muted">{formatBytes(memory.totalBytes)}</span>
								{` · ${formatPercent(memory.usedPercent)} used`}
							</DetailRow>
						)}
						{disk === null ? null : (
							<DetailRow icon={<HardDriveIcon className="size-3.5" />} label="Disk">
								{disk.availableBytes === 0 ? (
									<>
										<span className="text-fg-muted">{formatBytes(disk.totalBytes)}</span>
										<span className="text-danger"> · Full</span>
									</>
								) : lowDisk ? (
									<span className="tabular-nums text-danger">
										{formatBytes(disk.availableBytes)} left
									</span>
								) : (
									<>
										<span className="text-fg-muted">{formatBytes(disk.totalBytes)}</span>
										{` · ${formatPercent(disk.usedPercent)} used`}
									</>
								)}
							</DetailRow>
						)}
						{cost === null ? null : (
							<DetailRow
								icon={<CoinIcon className="size-3.5" />}
								label="Agent cost"
								trailing={
									<Tooltip content="Estimated at API rates. Your actual bill may differ.">
										<button
											type="button"
											aria-label="About agent cost"
											className="ml-1 flex size-4 shrink-0 items-center justify-center text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
										>
											<InfoIcon className="size-3" />
										</button>
									</Tooltip>
								}
							>
								{formatCost(cost)}
							</DetailRow>
						)}
					</div>
				</div>
			</Popover>

			{renaming ? (
				<WorkspaceRenameDialog workspaceId={workspaceId} open onOpenChange={setRenaming} />
			) : null}
		</>
	);
}
