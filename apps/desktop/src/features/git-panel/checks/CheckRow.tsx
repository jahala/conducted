/**
 * @feature PR-04 Check row with log
 * Owns: one check. A state icon, the name, how long it ran, and an expandable log.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph ("Running, Failed, Cancelled, Pending, Waiting with
 * logs"); services-map.md 3.7.5 ("Failed job log": the last 1000 lines are kept).
 * Data: the log loads when the row expands, through the useCheckLog hook.
 * Must handle: a log that is still loading, one that fails to load ("Couldn't load the logs"),
 * one that expired or was never recorded, a check that has no job (external status), ANSI escape
 * codes in the log, a log of 1000 lines (windowed), and the log being copyable.
 * Test first: expanding a failed check requests its log once, and collapsing and expanding again
 * does not request it twice.
 */
import { notImplemented } from "@conducted/shared";
import type { CheckRun } from "../../../core/model.ts";

export interface CheckRowProps {
	check: CheckRun;
	expanded: boolean;
	onToggle: () => void;
}

export function CheckRow(_props: CheckRowProps): never {
	return notImplemented("PR-04");
}
