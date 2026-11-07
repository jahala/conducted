/**
 * @feature CLOUD-17 Cloud settings page
 * Owns: the rule that decides whether a cloud workspace may run while data privacy mode is on,
 * and which Worker calls count as running one.
 * Behaviour: docs/research/conductor/services-map.md 4.1.2 (`isCloudRestrictedByDataPrivacy =
 * enterprise_data_privacy === "true" && flag !== "true"`, where the flag is PostHog's
 * `cloud-in-data-privacy-mode`). The flag lets cloud hosting work while data privacy is on.
 * Our design choice: we run no flag service (the settings layers have no flag layer, and D004
 * leaves PostHog out), so the flag is off: a Mac in data privacy mode cannot run a cloud
 * workspace. Reading settings and stopping, removing or archiving a workspace still work, because
 * those do not start work in a sandbox. D113 records the choice.
 * Test first: data privacy on and the flag off restricts cloud runs; the flag on does not.
 */

/** The message a cloud call answers with while data privacy mode keeps cloud workspaces off. */
export const CLOUD_DATA_PRIVACY_MESSAGE =
	"Cloud workspaces cannot run while data privacy mode is on.";

/**
 * True when data privacy mode blocks cloud work: the Mac's `enterprise_data_privacy` setting is on
 * and the `cloud-in-data-privacy-mode` flag is not.
 */
export function isCloudRestrictedByDataPrivacy(
	enterpriseDataPrivacy: boolean,
	cloudInDataPrivacyMode: boolean,
): boolean {
	return enterpriseDataPrivacy && !cloudInDataPrivacyMode;
}

/**
 * The workspace routes that start work in a sandbox. State reads and the lifecycle's stop and
 * remove are not here: they change or read what exists, and a user must still be able to stop a
 * cloud workspace that is already running.
 */
const RUNNING_ROUTE = /^\/w\/[^/]+\/(start|git|exec|files|terminal|preview-url)$/;

/** True when this Worker request asks a cloud workspace to run. */
export function cloudRequestRuns(path: string): boolean {
	return RUNNING_ROUTE.test(path);
}
