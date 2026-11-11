/**
 * @feature APP-06 App updates that wait until agents are idle
 * Owns: the delay before the update notice checks again after the window regains focus. The
 * updates service and the notice share it.
 * Behaviour: services-map.md 6 (update checks).
 */
export const UPDATE_FOCUS_RECHECK_MS = 600_000;
