/**
 * @feature RUN-04 Preview frame
 * Owns: the surface that draws the web page and reports its load state.
 * Behaviour: ui-map.md 3.2 and 8.
 * Our design choice: an iframe on the local address. The Platform has no webview or browser
 * surface, so this is the surface the tab draws in place; it is not kept alive across tab
 * switches (that is the surface layer's job, NAV-15).
 * Must handle: load start, load finish, a load event that reports an error, a page that does not
 * answer before the timeout, and dispose on tab close.
 * Test first: a load failure event produces the failed state with the URL.
 */
import { useCallback, useEffect, useRef } from "react";

/** How long the frame waits for the page before reporting that it did not answer. */
const LOAD_TIMEOUT_MS = 12_000;

export type PreviewLoadState =
	| { kind: "loading" }
	| { kind: "ready"; title: string | null }
	| { kind: "failed"; reason: "refused" | "blocked" | "timeout" | "other"; url: string };

export interface PreviewFrameProps {
	url: string;
	onLoadState: (state: PreviewLoadState) => void;
}

export function PreviewFrame({ url, onLoadState }: PreviewFrameProps) {
	const reportRef = useRef(onLoadState);
	reportRef.current = onLoadState;
	const frameRef = useRef<HTMLIFrameElement>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const stopTimer = useCallback(() => {
		if (timerRef.current === null) return;
		clearTimeout(timerRef.current);
		timerRef.current = null;
	}, []);

	useEffect(() => {
		reportRef.current({ kind: "loading" });
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			reportRef.current({ kind: "failed", reason: "timeout", url });
		}, LOAD_TIMEOUT_MS);
		return stopTimer;
	}, [url, stopTimer]);

	useEffect(() => {
		const frame = frameRef.current;
		if (frame === null) return;
		const onError = () => {
			stopTimer();
			reportRef.current({ kind: "failed", reason: "blocked", url });
		};
		frame.addEventListener("error", onError);
		return () => frame.removeEventListener("error", onError);
	}, [url, stopTimer]);

	return (
		<iframe
			ref={frameRef}
			title="Preview"
			src={url}
			className="h-full w-full border-0 bg-canvas"
			onLoad={() => {
				stopTimer();
				reportRef.current({ kind: "ready", title: null });
			}}
		/>
	);
}
