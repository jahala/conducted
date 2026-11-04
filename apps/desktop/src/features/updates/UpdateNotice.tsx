/**
 * @feature APP-06 UpdateNotice
 * Owns: the sidebar notice for a downloaded update that installs when every agent is idle. Entry
 * point embedded by the sidebar footer.
 * Behaviour: ui-map.md 1.3 ("Will automatically restart when all agents are idle", "Restart when
 * idle", "See changes"); the settings key auto_restart_on_update_when_idle (services-map.md 4.2.3).
 * Data: useUpdateStatus() (state idle, checking, available, downloading, ready_when_idle, error;
 * version; error), useSetting for the auto-restart switch, useActions().app (installUpdate,
 * checkForUpdates). The text and actions per state are in update-notice-view.ts.
 * Must handle: nothing to show when idle or checking, the notice appearing while the user types
 * (no focus steal), an update that fails to download (error with Retry), the user clicking Restart
 * when idle while an agent is working (the app waits, the notice says so), dismissal until the next
 * version, and release notes that cannot be opened.
 * Test first: with state "ready_when_idle" and auto-restart off, the notice offers "Restart when
 * idle" and calls installUpdate once on click.
 */
import { notImplemented } from "@conducted/shared";

export function UpdateNotice(_props: Record<string, never>): never {
	return notImplemented("APP-06");
}
