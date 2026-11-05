/**
 * @feature CHAT-08 Grep card
 * Owns: The card for a content search: the pattern, filters and the matches.
 * Behaviour: frontend.md 5 (registry key 'grep').
 * Must handle: No matches; matches grouped by file; counts-only and files-only modes; a very large
 * result (cut).
 * Test first: A grep call renders its pattern and one group per matching file.
 */
import {
	asRecord,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

interface FileMatches {
	file: string;
	matches: { line: number | null; text: string }[];
}

/** Claude's grep output is `file:line:text`; a file-only mode is one path per line. */
function groupMatches(output: string): FileMatches[] {
	const groups = new Map<string, FileMatches>();
	for (const raw of textLines(output)) {
		if (raw.length === 0) continue;
		const withLine = /^(.*?):(\d+):(.*)$/.exec(raw);
		if (withLine !== null) {
			const file = withLine[1] ?? "";
			const line = Number(withLine[2]);
			const text = withLine[3] ?? "";
			const group = groups.get(file) ?? { file, matches: [] };
			group.matches.push({ line: Number.isFinite(line) ? line : null, text });
			groups.set(file, group);
			continue;
		}
		const file = raw.replace(/:$/, "");
		if (!groups.has(file)) groups.set(file, { file, matches: [] });
	}
	return [...groups.values()];
}

export function GrepCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const pattern = textField(input, "pattern", "query") ?? "";
	const path = textField(input, "path", "glob");
	const output = call.result?.output ?? "";
	const groups = groupMatches(output);
	const filters = path === null ? null : <span className="text-fg-subtle">in {path}</span>;
	return (
		<ToolCardFrame
			title="Grep"
			summary={pattern}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{filters}
					{groups.length === 0 ? (
						<p className="text-xs text-fg-subtle">No matches</p>
					) : (
						groups.map((group) => (
							<div key={group.file} className="flex flex-col gap-0.5">
								<span className="font-mono text-xs font-medium text-fg">{group.file}</span>
								{withKeys(group.matches, (match) => `${match.line}-${match.text}`, "match").map(
									({ key, item: match }) => (
										<div key={key} className="flex gap-2 font-mono text-xs">
											{match.line === null ? null : (
												<span className="w-8 shrink-0 text-right text-fg-subtle">{match.line}</span>
											)}
											<span className="whitespace-pre-wrap text-fg-muted">{match.text}</span>
										</div>
									),
								)}
							</div>
						))
					)}
				</div>
			}
		/>
	);
}
