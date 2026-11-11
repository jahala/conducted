/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the labels and the view shape a screen shows for a workspace's file sync, and the message
 * for a preview opened before the mirror exists. The file-sync service and the scripts panel share
 * them.
 * Behaviour: services-map.md 5B.7 (file sync).
 */

export const SYNC_OFF_LABEL = "Sync files is off";
export const SYNC_FOLDER_UNAVAILABLE_LABEL = "Sync folder unavailable";
export const SYNC_FAILED_LABEL = "Sync files failed";
export const LOCAL_TERMINAL_UNAVAILABLE_LABEL = "Local terminal unavailable";
/** Conductor's error when a local-mirror preview is opened before the mirror exists (CLOUD-11). */
export const PREVIEW_MIRROR_UNAVAILABLE_MESSAGE =
	"Couldn't open preview: local workspace mirror is unavailable.";

/**
 * What a screen shows. `local` is a Mac workspace, which has no sync; `off` is the setting turned
 * off before a mirror exists; `unavailable` means the mirror folder is gone.
 */
export type FileSyncView =
	| { state: "local" }
	| { state: "off"; label: typeof SYNC_OFF_LABEL }
	| {
			state: "unavailable";
			label: typeof SYNC_FOLDER_UNAVAILABLE_LABEL;
			localTerminalLabel: typeof LOCAL_TERMINAL_UNAVAILABLE_LABEL;
	  }
	| { state: "syncing"; label: string; mirrorPath: string }
	| {
			state: "synced";
			label: string;
			mirrorPath: string;
			lastSyncedAt: number;
			files: number;
			truncated: boolean;
	  }
	| { state: "failed"; label: typeof SYNC_FAILED_LABEL; message: string };
