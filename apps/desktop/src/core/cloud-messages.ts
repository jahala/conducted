/**
 * @feature CLOUD-17 The Mac's personal cloud settings
 * Owns: the messages the Cloud settings page shows when the cloud settings cannot be reached or an
 * environment variable cannot be saved. The cloud settings service and the page share them.
 * Behaviour: ui-map.md 6 (Cloud settings page).
 */

/** Conductor's message when its cloud settings cannot be reached, with our name (D002). */
export const CLOUD_SETTINGS_UNREACHABLE =
	"Conducted could not connect to cloud settings. Try again.";

/** What the Environment page says when a variable could not be saved. */
export const CLOUD_ENV_SAVE_FAILED = "Couldn't update your environment variables";
