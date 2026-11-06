/**
 * @feature CHAT-08 Read card
 * Owns: The card for a file read: path, line range and a short excerpt of the result.
 * Behaviour: frontend.md 5 (registry key 'read'), ui-map.md 3.3.
 * Must handle: Result not back yet (running); result is an error (file missing, shown in the
 * frame); a very large result (truncated flag, 'Output was cut'); a path inside the workspace is
 * shown relative; clicking the path opens the file tab.
 * Test first: A read call with a result shows the relative path; clicking it sets tab=file and path
 * in the URL.
 */
import {
	asRecord,
	FileBadge,
	numberField,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const EXCERPT_LINES = 20;

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;

/** Conductor's words: "Reading" until the result is back, then "Read image" or "Read 40 lines". */
function readTitle(running: boolean, lineCount: number, path: string): string {
	if (running) return "Reading";
	if (IMAGE_FILE.test(path)) return "Read image";
	return `Read ${lineCount} lines`;
}

export function ReadCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "file_path", "path") ?? "";
	const offset = numberField(input, "offset");
	const limit = numberField(input, "limit");
	const output = call.result?.output ?? "";
	const lines = textLines(output);
	const excerpt = lines.slice(0, EXCERPT_LINES);
	const range =
		offset === null
			? null
			: limit === null
				? `from line ${offset}`
				: `lines ${offset}-${offset + limit - 1}`;
	return (
		<ToolCardFrame
			title={readTitle(call.result === null, lines.length, path)}
			summary={<FileBadge path={path} />}
			keepSummary
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{range === null ? null : <p className="text-xs text-fg-muted">{range}</p>}
					{excerpt.length > 0 ? (
						<pre className="max-h-64 overflow-auto whitespace-pre font-mono text-xs text-fg-muted">
							{excerpt.join("\n")}
						</pre>
					) : null}
					{lines.length > excerpt.length ? (
						<p className="text-xs text-fg-subtle">and {lines.length - excerpt.length} more lines</p>
					) : null}
					{call.result?.truncated ? (
						<p className="text-xs text-fg-subtle">Output was cut; the start and end are shown.</p>
					) : null}
				</div>
			}
		/>
	);
}
