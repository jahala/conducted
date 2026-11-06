/**
 * @feature RUN-04 Preview frame
 * Owns: the surface that draws the web page and reports its load state.
 * Behaviour: ui-map.md 3.2 and 8.
 * Our design choice: an iframe on the local address. The Platform has no webview or browser
 * surface, so this is the surface the tab draws in place; it is not kept alive across tab
 * switches (that is the surface layer's job, NAV-15).
 * Our design choice: an iframe has no error event, and it fires `load` over the browser's own
 * error page, so the frame probes the address with a request before it draws anything. A refused
 * probe is tried again every `PROBE_INTERVAL_MS`. When nothing answers within `LOAD_TIMEOUT_MS`
 * the frame reports the failure, keeps probing, and draws the page by itself once the server
 * answers. Both times are our dials; the research has none. The CSP allows the probe and the
 * frame for `http://localhost:*` and `http://127.0.0.1:*` (`tauri.conf.json`, checked by
 * csp.run-04.test.ts).
 * Must handle: load start, load finish, a refused connection (reported as `refused` after the
 * timeout), a server that answers the probe but whose page never finishes loading (`timeout`),
 * a server that starts after the failure was reported, and dispose on tab close (the probe is
 * aborted and every timer cleared). A page that refuses to be framed cannot be told apart from
 * one that loaded, because its headers are hidden from the probe; it shows as loaded.
 * Test first: a load failure event produces the failed state with the URL.
 */
import { useEffect, useRef, useState } from "react";

/** How long the frame waits for the page before reporting that it did not answer. */
const LOAD_TIMEOUT_MS = 12_000;
/** How often a refused address is asked again. */
const PROBE_INTERVAL_MS = 1_000;

export type PreviewLoadState =
	| { kind: "loading" }
	| { kind: "ready"; title: string | null }
	| { kind: "failed"; reason: "refused" | "timeout"; url: string };

export interface PreviewFrameProps {
	url: string;
	onLoadState: (state: PreviewLoadState) => void;
	/** Tests shorten the waits; the tab uses the defaults. */
	loadTimeoutMs?: number;
	probeIntervalMs?: number;
}

export function PreviewFrame({
	url,
	onLoadState,
	loadTimeoutMs = LOAD_TIMEOUT_MS,
	probeIntervalMs = PROBE_INTERVAL_MS,
}: PreviewFrameProps) {
	const reportRef = useRef(onLoadState);
	reportRef.current = onLoadState;
	const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [answered, setAnswered] = useState(false);

	const stopDeadline = (): void => {
		if (deadlineRef.current === null) return;
		clearTimeout(deadlineRef.current);
		deadlineRef.current = null;
	};

	useEffect(() => {
		const aborter = new AbortController();
		let retry: ReturnType<typeof setTimeout> | null = null;
		let refused = false;
		let failed = false;
		setAnswered(false);
		reportRef.current({ kind: "loading" });
		deadlineRef.current = setTimeout(() => {
			deadlineRef.current = null;
			failed = true;
			reportRef.current({ kind: "failed", reason: refused ? "refused" : "timeout", url });
		}, loadTimeoutMs);

		const probe = (): void => {
			fetch(url, { mode: "no-cors", cache: "no-store", signal: aborter.signal }).then(
				() => {
					if (aborter.signal.aborted) return;
					refused = false;
					// After a reported failure the page starts again, so the tab shows it loading.
					if (failed) reportRef.current({ kind: "loading" });
					setAnswered(true);
				},
				() => {
					if (aborter.signal.aborted) return;
					refused = true;
					retry = setTimeout(probe, probeIntervalMs);
				},
			);
		};
		probe();

		return () => {
			aborter.abort();
			if (retry !== null) clearTimeout(retry);
			if (deadlineRef.current !== null) clearTimeout(deadlineRef.current);
			deadlineRef.current = null;
		};
	}, [url, loadTimeoutMs, probeIntervalMs]);

	if (!answered) return null;
	return (
		<iframe
			title="Preview"
			src={url}
			className="h-full w-full border-0 bg-canvas"
			onLoad={() => {
				stopDeadline();
				reportRef.current({ kind: "ready", title: null });
			}}
		/>
	);
}
