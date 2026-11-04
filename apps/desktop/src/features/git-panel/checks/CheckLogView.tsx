/**
 * @feature PR-04 Check log view
 * Owns: the log text of one check inside the Checks tab. Monospace, ANSI colours shown, last lines
 * first in view.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph ("with logs"); services-map.md 3.7.5.
 * Our design choice: render with a small ANSI-to-spans pure function, not xterm, because the log
 * is static text.
 * Must handle: empty log, a log of one very long line, loading, error, expired ("No logs were
 * recorded, or they have expired"), and a copy button.
 * Test first: a log with the escape for red text renders that text in a span with the red class.
 */

import { notImplemented } from "@conducted/shared";
import type { Loadable } from "../../../core/api.ts";

export interface CheckLogViewProps {
	log: Loadable<string>;
	onRetry: () => void;
}

export function CheckLogView(_props: CheckLogViewProps): never {
	return notImplemented("PR-04");
}
