/**
 * @feature REV-08 Find and replace bar
 * Owns: the bar above the editor for searching in the open file.
 * Behaviour: ui-map.md 3.2 (edit mode: find and replace bar with Replace, Replace All, Previous,
 * Next).
 * Our design choice: this is our own bar instead of the library's search panel, so it matches the
 * app's design. It only shows the state: the editor pane finds the matches, selects the current
 * one in the editor and scrolls to it, and Replace with no current match replaces the first.
 * Must handle: no match (count shows 0, buttons disabled), regex errors (inline, no throw), match
 * case and whole word toggles, Enter for next and Shift+Enter for previous, and Escape closing.
 * Test first: with the query "a" in "banana", the count reads 3 and Next moves between matches.
 */
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";

export interface FindReplaceBarProps {
	query: string;
	replacement: string;
	matchCount: number;
	currentIndex: number | null;
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
	regexError: string | null;
	onQueryChange: (query: string) => void;
	onReplacementChange: (replacement: string) => void;
	onToggle: (option: "caseSensitive" | "wholeWord" | "regex") => void;
	onNext: () => void;
	onPrevious: () => void;
	onReplace: () => void;
	onReplaceAll: () => void;
	onClose: () => void;
}

export function FindReplaceBar({
	query,
	replacement,
	matchCount,
	currentIndex,
	caseSensitive,
	wholeWord,
	regex,
	regexError,
	onQueryChange,
	onReplacementChange,
	onToggle,
	onNext,
	onPrevious,
	onReplace,
	onReplaceAll,
	onClose,
}: FindReplaceBarProps) {
	const hasMatches = matchCount > 0;
	return (
		<search
			aria-label="Find in file"
			className="flex flex-col gap-1 border-b border-border bg-surface px-2 py-1.5"
		>
			<div className="flex items-center gap-1">
				<Input
					autoFocus
					aria-label="Find"
					placeholder="Find"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							if (event.shiftKey) onPrevious();
							else onNext();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							onClose();
						}
					}}
					className="h-7 min-w-0 flex-1"
				/>
				<span aria-live="polite" className="min-w-12 text-center text-xs text-fg-muted">
					<span role="status" aria-label={`${matchCount} matches`}>
						{matchCount}
					</span>
					{currentIndex === null ? null : (
						<span>
							{" "}
							({currentIndex + 1} of {matchCount})
						</span>
					)}
				</span>
				<Button size="xs" variant="ghost" onClick={onPrevious} disabled={!hasMatches}>
					Previous
				</Button>
				<Button size="xs" variant="ghost" onClick={onNext} disabled={!hasMatches}>
					Next
				</Button>
				<Button
					size="xs"
					variant={caseSensitive ? "secondary" : "ghost"}
					aria-pressed={caseSensitive}
					onClick={() => onToggle("caseSensitive")}
				>
					Match case
				</Button>
				<Button
					size="xs"
					variant={wholeWord ? "secondary" : "ghost"}
					aria-pressed={wholeWord}
					onClick={() => onToggle("wholeWord")}
				>
					Whole word
				</Button>
				<Button
					size="xs"
					variant={regex ? "secondary" : "ghost"}
					aria-pressed={regex}
					onClick={() => onToggle("regex")}
				>
					Regex
				</Button>
				<Button size="xs" variant="ghost" onClick={onClose}>
					Close
				</Button>
			</div>
			<div className="flex items-center gap-1">
				<Input
					aria-label="Replace with"
					placeholder="Replace with"
					value={replacement}
					onChange={(event) => onReplacementChange(event.target.value)}
					className="h-7 min-w-0 flex-1"
				/>
				<Button size="xs" variant="ghost" onClick={onReplace} disabled={!hasMatches}>
					Replace
				</Button>
				<Button size="xs" variant="ghost" onClick={onReplaceAll} disabled={!hasMatches}>
					Replace All
				</Button>
			</div>
			{regexError === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{regexError}
				</p>
			)}
		</search>
	);
}
