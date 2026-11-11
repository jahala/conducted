/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the "Sync files" row of a cloud workspace's header popover: the row's label and description,
 * the status line, the workspace's mirror switch, its local folder with a copy action, and the
 * failure block with Conductor's "Sync failed" and "Internal sync error" copy.
 * Behaviour: ui-map.md 3.7 (the file-sync states), services-map.md 5B.10.1 (the mirror, its
 * direction and triggers), and Conductor's sync row (`ygo`, `K7t` in renderApp) for the words.
 * Our design choice: the row is where Conductor puts it, in the workspace header's popover. The
 * switch turns this workspace's mirror on or off through the file-sync service; the Advanced
 * setting gives a new cloud workspace its first value (D111), and the workspace row keeps it
 * across restarts (migration 0019).
 * Must handle: a local workspace (nothing); a workspace that is not ready (the switch waits); a
 * failed sync (the message and its copy actions); a long mirror path (it truncates); a switch that
 * fails (Conductor's "Failed to update sync preference" or "Failed to start file sync" toast, and
 * the switch keeps its saved value).
 * Test first: shows Conductor's words and turns the workspace's mirror on and off.
 */
import type { WorkspaceId } from "@conducted/shared";
import {
	COPY_INTERNAL_SYNC_ERROR_TOOLTIP,
	COPY_SYNC_ERROR_TOOLTIP,
	COPY_SYNC_FOLDER_PATH_TOOLTIP,
	INTERNAL_SYNC_ERROR_LABEL,
	LOCAL_FOLDER_LABEL,
	SYNC_BACKGROUND_DESCRIPTION,
	SYNC_FAILED_STATUS,
	SYNC_FILES_DESCRIPTION,
	SYNC_FILES_LABEL,
	SYNC_MIRROR_DESCRIPTION,
	SYNC_TO_DIRECTORY_LABEL,
	syncSwitchFailedMessage,
} from "../../core/file-sync-view.ts";
import { useActions, useFileSyncStatus, useWorkspace } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { CopyIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

export interface CloudFileSyncRowProps {
	workspaceId: WorkspaceId;
}

export function CloudFileSyncRow({ workspaceId }: CloudFileSyncRowProps) {
	const workspace = useWorkspace(workspaceId);
	const view = useFileSyncStatus(workspaceId);
	const actions = useActions();

	if (workspace.state !== "ready" || workspace.data.host.kind !== "cloud") return null;
	if (view.state === "local") return null;

	const ready = workspace.data.state === "ready";
	const enabled = view.enabled;
	const syncing = view.state === "syncing";
	const failed = view.state === "failed";

	const setEnabled = (checked: boolean) => {
		void actions.files.setSyncEnabled(workspaceId, checked).then((result) => {
			if (!result.ok) toast.error(syncSwitchFailedMessage(checked, result.error.message));
		});
	};

	const copy = (text: string) => {
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError("Couldn't copy", result.error);
		});
	};

	return (
		<div className="flex flex-col gap-2 text-xs">
			<div className="min-w-0 truncate font-medium text-fg">{SYNC_TO_DIRECTORY_LABEL}</div>
			<div className="flex items-center gap-2">
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="shrink-0 font-medium text-fg">{SYNC_FILES_LABEL}</span>
					<span className="flex size-3.5 shrink-0 items-center justify-center">
						{syncing ? (
							<Spinner label={view.label} size="sm" />
						) : (
							<span
								aria-hidden="true"
								className={
									failed
										? "size-1.5 rounded-full bg-danger"
										: view.state === "synced"
											? "size-1.5 rounded-full bg-success"
											: "size-1.5 rounded-full bg-fg-subtle"
								}
							/>
						)}
					</span>
					<span className="min-w-0 truncate text-fg-muted" title={view.label}>
						{view.label}
					</span>
				</span>
				<Switch
					data-testid="remote-file-sync-button"
					checked={enabled}
					disabled={!ready}
					aria-label={enabled ? "Turn off remote file sync" : "Turn on remote file sync"}
					onCheckedChange={setEnabled}
				/>
			</div>
			<p className="text-fg-muted">{SYNC_FILES_DESCRIPTION}</p>
			<p className="text-fg-muted">{SYNC_BACKGROUND_DESCRIPTION}</p>
			<p className="text-fg-muted">{SYNC_MIRROR_DESCRIPTION}</p>
			{view.mirrorPath === "" ? null : (
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="shrink-0 text-fg-muted">{LOCAL_FOLDER_LABEL}</span>
					<span className="min-w-0 flex-1 truncate font-mono text-fg">{view.mirrorPath}</span>
					<IconButton
						size="xs"
						label={COPY_SYNC_FOLDER_PATH_TOOLTIP}
						title={COPY_SYNC_FOLDER_PATH_TOOLTIP}
						icon={<CopyIcon className="size-3" />}
						onClick={() => copy(view.mirrorPath)}
					/>
				</div>
			)}
			{view.state === "off" || view.state === "unavailable" ? (
				<p className="text-fg-muted">{view.description}</p>
			) : null}
			{failed ? (
				<div className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger/5 p-2 text-danger">
					<div className="flex items-center justify-between gap-2">
						<span className="font-medium">{SYNC_FAILED_STATUS}</span>
						<IconButton
							size="xs"
							label={COPY_SYNC_ERROR_TOOLTIP}
							title={COPY_SYNC_ERROR_TOOLTIP}
							icon={<CopyIcon className="size-3" />}
							onClick={() => copy(view.message)}
						/>
					</div>
					<p className="break-words">{view.message}</p>
					<div className="mt-1 flex items-center justify-between gap-2">
						<span className="text-[11px] font-semibold uppercase">{INTERNAL_SYNC_ERROR_LABEL}</span>
						<IconButton
							size="xs"
							label={COPY_INTERNAL_SYNC_ERROR_TOOLTIP}
							title={COPY_INTERNAL_SYNC_ERROR_TOOLTIP}
							icon={<CopyIcon className="size-3" />}
							onClick={() => copy(view.message)}
						/>
					</div>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
						{view.message}
					</pre>
				</div>
			) : null}
		</div>
	);
}
