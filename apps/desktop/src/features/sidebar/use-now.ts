/**
 * @feature NAV-03 Current time for the sidebar
 * Owns: a clock value that moves forward once a minute, so the list's relative times ("5m") stay
 * true without a reload.
 * Behaviour: ui-map.md 4 (a row shows how long ago the workspace was active).
 * Our design choice: the list reads the time once and hands it to every row, so 300 rows share one
 * timer. The time source is a parameter; the container exposes no clock to screens yet, so the
 * caller passes none and gets Date.now at this edge.
 * Must handle: the timer is cleared when the list unmounts or the source changes; a source that
 * changes restarts the timer.
 * Test first: after 60 seconds the hook returns the new time; after unmount no timer is left.
 */
import { useEffect, useState } from "react";

export const MINUTE_MS = 60_000;

export function useNow(read: () => number = Date.now, everyMs: number = MINUTE_MS): number {
	const [now, setNow] = useState(read);
	useEffect(() => {
		setNow(read());
		const timer = setInterval(() => setNow(read()), everyMs);
		return () => clearInterval(timer);
	}, [read, everyMs]);
	return now;
}
