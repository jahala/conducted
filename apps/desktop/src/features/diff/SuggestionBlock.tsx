/**
 * @feature REV-03 Suggestion block
 * Owns: the "suggested change" part of a comment. It shows the original lines and the suggested
 * replacement as a small diff.
 * Behaviour: ui-map.md 3.6 ("Suggested change block"). The comment row stores the replacement text
 * in diff_comments.suggestion.
 * Must handle: a suggestion identical to the original (shown as no change), an empty suggestion
 * (means delete the lines), and very long suggestions (scroll, not grow).
 * Test first: original "a" and suggestion "b" render one removed and one added line.
 */
import { useMemo } from "react";

export interface SuggestionBlockProps {
	original: string;
	suggestion: string;
	filePath: string;
}

interface DiffRow {
	key: string;
	kind: "unchanged" | "removed" | "added";
	text: string;
}

function linesOf(text: string): string[] {
	const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
	return withoutFinalNewline === "" ? [] : withoutFinalNewline.split("\n");
}

/** A line diff by longest common subsequence, so unchanged lines stay as context. */
function diffLines(original: string[], suggestion: string[]): DiffRow[] {
	const rows: DiffRow[] = [];
	let nextKey = 0;
	const push = (kind: DiffRow["kind"], text: string): void => {
		rows.push({ key: `row-${nextKey}`, kind, text });
		nextKey += 1;
	};
	const width = suggestion.length + 1;
	const table = Array.from({ length: original.length + 1 }, () => new Array<number>(width).fill(0));
	for (let left = original.length - 1; left >= 0; left -= 1) {
		const row = table[left];
		if (row === undefined) continue;
		for (let right = suggestion.length - 1; right >= 0; right -= 1) {
			row[right] =
				original[left] === suggestion[right]
					? (table[left + 1]?.[right + 1] ?? 0) + 1
					: Math.max(table[left + 1]?.[right] ?? 0, table[left]?.[right + 1] ?? 0);
		}
	}
	let left = 0;
	let right = 0;
	while (left < original.length && right < suggestion.length) {
		if (original[left] === suggestion[right]) {
			push("unchanged", original[left] ?? "");
			left += 1;
			right += 1;
		} else if ((table[left + 1]?.[right] ?? 0) >= (table[left]?.[right + 1] ?? 0)) {
			push("removed", original[left] ?? "");
			left += 1;
		} else {
			push("added", suggestion[right] ?? "");
			right += 1;
		}
	}
	while (left < original.length) {
		push("removed", original[left] ?? "");
		left += 1;
	}
	while (right < suggestion.length) {
		push("added", suggestion[right] ?? "");
		right += 1;
	}
	return rows;
}

const rowClass: Record<DiffRow["kind"], string> = {
	unchanged: "text-fg-muted",
	removed: "bg-danger/10 text-danger",
	added: "bg-success/10 text-success",
};

export function SuggestionBlock({ original, suggestion, filePath }: SuggestionBlockProps) {
	const rows = useMemo(
		() => diffLines(linesOf(original), linesOf(suggestion)),
		[original, suggestion],
	);
	const changed = rows.some((row) => row.kind !== "unchanged");

	return (
		<section aria-label="Suggested change" className="mt-2 flex flex-col gap-1">
			<p className="text-xs font-medium text-fg-muted">Suggested change</p>
			{changed ? (
				<div className="max-h-60 overflow-auto rounded-md border border-border bg-surface font-mono text-code">
					{rows.map((row) => (
						<div
							key={row.key}
							data-kind={row.kind}
							className={`flex gap-2 px-2 py-0.5 ${rowClass[row.kind]}`}
						>
							<span aria-hidden="true" className="select-none">
								{row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " "}
							</span>
							<span className="whitespace-pre-wrap">{row.text}</span>
						</div>
					))}
				</div>
			) : (
				<p className="text-xs text-fg-muted">No change to {filePath}.</p>
			)}
		</section>
	);
}
