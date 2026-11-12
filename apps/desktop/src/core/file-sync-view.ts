/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the labels, descriptions and view shape a screen shows for a workspace's file sync, the
 * toasts for a Sync files switch that fails, and the message for a preview opened before the
 * mirror exists. The file-sync service and every screen that shows its state share them.
 * Behaviour: services-map.md 5B.7 and 5B.10.1 (file sync); ui-map.md 3.7 (the statuses Conductor
 * shows). The wording is Conductor's, read from its sync row (renderApp `ygo`, `Joe`, `SZs`).
 */

export const SYNC_OFF_LABEL = "Sync files is off";
export const SYNC_FOLDER_UNAVAILABLE_LABEL = "Sync folder unavailable";
export const SYNC_FAILED_LABEL = "Sync files failed";
export const LOCAL_TERMINAL_UNAVAILABLE_LABEL = "Local terminal unavailable";
/** The row's own label and the two lines Conductor keeps behind its hover card. */
export const SYNC_FILES_LABEL = "Sync files";
export const SYNC_FILES_DESCRIPTION =
	"Keeps this cloud workspace's files mirrored to a local folder so local tools can inspect and edit them.";
export const SYNC_BACKGROUND_DESCRIPTION =
	"Changes continue syncing in the background while the switch is on.";
export const SYNC_MIRROR_DESCRIPTION =
	"Mirrors this cloud workspace to a local folder for local tools.";
export const LOCAL_FOLDER_LABEL = "Local folder";
export const SYNC_TO_DIRECTORY_LABEL = "Sync to a local directory";
export const COPY_SYNC_FOLDER_PATH_TOOLTIP = "Copy sync folder path";
export const COPY_SYNC_ERROR_TOOLTIP = "Copy sync error";
export const COPY_INTERNAL_SYNC_ERROR_TOOLTIP = "Copy internal sync error";
/** The status words Conductor's status line shows (`z$t` in its bundle). */
export const SYNC_FAILED_STATUS = "Sync failed";
export const SYNCING_STATUS = "Syncing…";
export const IN_SYNC_STATUS = "In sync";
export const SYNCED_TERMINAL_STATUS = "File changes synced to local";
export const READY_TO_SYNC_STATUS = "Ready to sync";
export const RESUMING_SYNC_STATUS = "Resuming sync…";
export const SYNC_OFF_STATUS = "Sync files is off. Local files may be outdated.";
export const INTERNAL_SYNC_ERROR_LABEL = "Internal sync error";
/** What a state's sentence is when the reason differs (`kZs`, `TZs` in Conductor's bundle). */
export const SYNC_OFF_DESCRIPTION = "Runs against a synced copy on your Mac.";
export const SYNC_FOLDER_REMOVED_DESCRIPTION =
	"The local sync folder was removed. Sync files will recreate it when it resumes.";
export const RESTART_SYNC_DESCRIPTION = "Restart sync to recreate the local folder.";
export const LOCAL_TERMINAL_SYNC_NOT_READY_DESCRIPTION =
	"Sync files needs to be ready before this terminal starts.";
export const LOCAL_TERMINAL_SYNC_FAILED_DESCRIPTION =
	"The local terminal cannot start until Sync files recovers.";
export const WORKSPACE_NOT_READY_DESCRIPTION = "The workspace is not ready yet.";
/**
 * The toast when the Sync files switch fails (Conductor's `ygo`, renderApp @5583234 and @5583511).
 * Turning it off can fail only in the save. Turning it on fails in the save or the first sync, and
 * Conductor names both as a failed start, without a colon when the error has no message.
 */
export const UPDATE_SYNC_PREFERENCE_FAILED = "Failed to update sync preference";
export const START_FILE_SYNC_FAILED = "Failed to start file sync";

export function syncSwitchFailedMessage(enabled: boolean, reason: string): string {
	if (!enabled) return `${UPDATE_SYNC_PREFERENCE_FAILED}: ${reason}`;
	return reason === "" ? START_FILE_SYNC_FAILED : `${START_FILE_SYNC_FAILED}: ${reason}`;
}

/** Conductor's error when a local-mirror preview is opened before the mirror exists (CLOUD-11). */
export const PREVIEW_MIRROR_UNAVAILABLE_MESSAGE =
	"Couldn't open preview: local workspace mirror is unavailable.";

/**
 * What a screen shows. `local` is a Mac workspace, which has no sync; `off` is the switch turned
 * off before a mirror exists; `unavailable` means the mirror folder is gone.
 */
export type FileSyncView =
	| { state: "local" }
	| {
			state: "off";
			label: typeof SYNC_OFF_LABEL;
			description: typeof SYNC_OFF_DESCRIPTION;
			mirrorPath: string;
			enabled: false;
	  }
	| {
			state: "unavailable";
			label: typeof SYNC_FOLDER_UNAVAILABLE_LABEL;
			description: typeof SYNC_FOLDER_REMOVED_DESCRIPTION;
			mirrorPath: string;
			localTerminalLabel: typeof LOCAL_TERMINAL_UNAVAILABLE_LABEL;
			localTerminalDescription: typeof RESTART_SYNC_DESCRIPTION;
			enabled: boolean;
	  }
	| {
			state: "syncing";
			label: typeof SYNCING_STATUS;
			mirrorPath: string;
			enabled: true;
	  }
	| {
			state: "synced";
			label: typeof IN_SYNC_STATUS;
			mirrorPath: string;
			lastSyncedAt: number;
			files: number;
			truncated: boolean;
			enabled: true;
	  }
	| {
			state: "failed";
			label: typeof SYNC_FAILED_LABEL;
			message: string;
			description: typeof LOCAL_TERMINAL_SYNC_FAILED_DESCRIPTION;
			mirrorPath: string;
			enabled: boolean;
	  };

/** The sentence a local terminal says when the mirror cannot be used, from the same view. */
export function localTerminalDescription(view: FileSyncView): string {
	switch (view.state) {
		case "failed":
			return LOCAL_TERMINAL_SYNC_FAILED_DESCRIPTION;
		case "unavailable":
			return RESTART_SYNC_DESCRIPTION;
		default:
			return LOCAL_TERMINAL_SYNC_NOT_READY_DESCRIPTION;
	}
}
