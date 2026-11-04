/**
 * @feature APP-08 macOS version warning
 * Owns: the dismissible warning in the sidebar footer when the Mac's macOS version is too old for the app.
 * Behaviour: ui-map.md 1.3 (status areas: "macOS version warning with dismiss button"), 4.8 (sidebar
 * footer); coverage/inventory-controls.md (the dismiss button has the aria label "Dismiss macOS version
 * warning").
 * Data: `SystemInfo.osVersion` from useSystemInfo (core/hooks.ts, PLAT-32). The oldest supported version
 * comes from the build's minimum system version, passed in so the check can be tested.
 * Our design choice: the dismissal lasts until the app version changes, so a later update that raises the
 * minimum shows the warning again. It is stored as a callout dismissal (APP-10). The warning uses the
 * warning colour token, a function-only state.
 * Must handle: a version string with two or three parts ("15.4", "15.4.1"); a version that cannot be read
 * (no warning, the error is logged); a Mac at exactly the minimum (no warning); dismissal remembered
 * across restarts; the sidebar footer collapsed (the warning moves above the update notice, not under it).
 * Test first: osVersion "13.6.1" with minimum "14.0" shows the warning; "14.0" shows nothing; dismissing
 * hides it.
 */
import { notImplemented } from "@conducted/shared";
import type { SystemInfo } from "../../core/model.ts";

export interface MacosVersionWarningProps {
	system: SystemInfo;
	/** The lowest macOS version this build supports, for example "14.0". */
	minimumOsVersion: string;
	dismissed: boolean;
	onDismiss: () => void;
}

export function MacosVersionWarning(_props: MacosVersionWarningProps): never {
	return notImplemented("APP-08");
}
