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
import { useEffect, useRef } from "react";
import type { Loadable } from "../../../core/api.ts";
import { CopyButton } from "../../../ui/CopyButton.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";

export interface CheckLogViewProps {
	log: Loadable<string>;
	onRetry: () => void;
	/** Writes the log text to the clipboard. Left out when the caller cannot copy. */
	onCopy?: (text: string) => unknown;
}

export interface LogSpan {
	text: string;
	/** The colour and weight classes for this run of text, or null for the log's own colour. */
	className: string | null;
}

const COLOUR_BY_CODE: Readonly<Record<number, string>> = {
	30: "text-term-black",
	31: "text-term-red",
	32: "text-term-green",
	33: "text-term-yellow",
	34: "text-term-blue",
	35: "text-term-magenta",
	36: "text-term-cyan",
	37: "text-term-white",
	90: "text-term-bright-black",
	91: "text-term-bright-red",
	92: "text-term-bright-green",
	93: "text-term-bright-yellow",
	94: "text-term-bright-blue",
	95: "text-term-bright-magenta",
	96: "text-term-bright-cyan",
	97: "text-term-bright-white",
};

const isColourClass = (name: string): boolean => name.startsWith("text-term-");

/** The escape character that starts every terminal control sequence. */
const ESC = String.fromCharCode(27);

/** Splits ANSI SGR escape sequences into runs with the class each one asks for. */
export function ansiToSpans(text: string): LogSpan[] {
	const spans: LogSpan[] = [];
	const classes: string[] = [];
	let last = 0;
	const pattern = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");
	let match = pattern.exec(text);
	while (match !== null) {
		if (match.index > last) {
			spans.push({
				text: text.slice(last, match.index),
				className: classes.length === 0 ? null : classes.join(" "),
			});
		}
		const codes = (match[1] ?? "")
			.split(";")
			.filter((code) => code.length > 0)
			.map(Number);
		for (const code of codes) {
			if (code === 0) {
				classes.length = 0;
			} else if (code === 1) {
				if (!classes.includes("font-semibold")) classes.push("font-semibold");
			} else if (code === 22) {
				removeClass(classes, (name) => name === "font-semibold");
			} else if (code === 39) {
				removeClass(classes, isColourClass);
			} else {
				const colour = COLOUR_BY_CODE[code];
				if (colour !== undefined) {
					removeClass(classes, isColourClass);
					classes.push(colour);
				}
			}
		}
		last = pattern.lastIndex;
		match = pattern.exec(text);
	}
	if (last < text.length) {
		spans.push({
			text: text.slice(last),
			className: classes.length === 0 ? null : classes.join(" "),
		});
	}
	return spans;
}

function removeClass(classes: string[], predicate: (name: string) => boolean): void {
	for (let index = classes.length - 1; index >= 0; index -= 1) {
		if (predicate(classes[index] as string)) classes.splice(index, 1);
	}
}

function errorText(error: { code: string; message: string }): string {
	if (error.code === "github_check_no_job" || error.code === "github_check_missing") {
		return "No logs available.";
	}
	if (error.code === "github_check_log_expired") {
		return "No logs were recorded, or they have expired.";
	}
	return "Couldn't load the logs.";
}

export function CheckLogView({ log, onRetry, onCopy }: CheckLogViewProps) {
	const pre = useRef<HTMLPreElement>(null);
	const text = log.state === "ready" ? log.data : "";

	// The most recent lines matter most, so a loaded log starts at its end.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new log text scrolls the loaded view to its end.
	useEffect(() => {
		const node = pre.current;
		if (node !== null) node.scrollTop = node.scrollHeight;
	}, [text]);

	if (log.state === "loading") {
		return (
			<div className="flex items-center justify-center p-4">
				<Spinner label="Loading logs" />
			</div>
		);
	}
	if (log.state === "error") {
		return (
			<EmptyState
				compact
				tone="failed"
				title={errorText(log.error)}
				body={log.error.message}
				action={
					<button
						type="button"
						onClick={onRetry}
						className="h-7 rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-hover"
					>
						Try again
					</button>
				}
			/>
		);
	}
	if (text.trim().length === 0) {
		return <EmptyState compact title="No logs available." />;
	}

	const spans = ansiToSpans(text);
	let offset = 0;

	return (
		<div className="flex min-h-0 flex-col border-t border-separator bg-canvas">
			<div className="flex items-center justify-between gap-2 px-2 py-1">
				<span className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">Log</span>
				{onCopy === undefined ? null : (
					<CopyButton text={text} onCopy={onCopy} label="Copy log" size="xs" />
				)}
			</div>
			<pre
				ref={pre}
				className="max-h-80 min-h-0 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 font-mono text-code text-fg"
			>
				{spans.map((span) => {
					const at = offset;
					offset += span.text.length;
					return (
						<span key={at} className={span.className ?? undefined}>
							{span.text}
						</span>
					);
				})}
			</pre>
		</div>
	);
}
