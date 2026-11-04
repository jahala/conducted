/**
 * @feature APP-07 Resource usage table
 * Owns: The table of CPU and memory per process, grouped by workspace, in the sidebar footer.
 * Behaviour: ui-map.md 1.3 and 4 item 8 ('Resources' table: Name, CPU, Mem; rows grouped by
 * workspace, sortable, 'Copy resource usage'; shown by the setting 'Show sidebar resource usage').
 * Our design choice: The footer placement is Conductor's inferred one. The table is hidden unless
 * the setting is on, and polls only while visible.
 * Must handle: Setting off (renders nothing); no data yet (skeleton rows); the platform cannot read
 * usage (one line saying so); sorting by CPU or memory; a process that exits between polls
 * disappears without a flicker; copy puts plain text in the clipboard.
 * Test first: With the setting on and two workspaces' processes, rows are grouped by workspace and
 * sorted by memory when that header is chosen.
 */
import { notImplemented } from "@conducted/shared";

export function ResourceUsageTable(_props: Record<string, never>): never {
	return notImplemented("APP-07");
}
