/**
 * @feature RUN-06 Terminal find bar
 * Owns: the small bar for searching the terminal's scrollback, and the pure search over the
 * terminal buffer it drives.
 * Behaviour: ui-map.md 3.7 ("Find in terminal", Cmd+F).
 * Open question: xterm's search addon (@xterm/addon-search) is not installed, so the search walks
 * `Terminal.buffer` instead.
 * Must handle: no match, case and regex toggles, Enter and Shift+Enter, Escape closing and
 * returning focus to the terminal, and the query kept when the bar closes and opens again.
 * Test first: searching for text that is in the scrollback reports a match and Next moves to the
 * following one.
 */

import { IconButton } from "../../ui/IconButton.tsx";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "../../ui/icons.tsx";

export interface TerminalFindOptions {
	query: string;
	caseSensitive: boolean;
	regex: boolean;
}

export interface TerminalFindMatch {
	/** The 0-based line in the terminal buffer. */
	line: number;
	/** The 0-based column where the match starts. */
	column: number;
	length: number;
}

export type TerminalFindDirection = "next" | "previous";

/** The small part of xterm's `IBuffer` the search needs. */
export interface FindableLine {
	translateToString(trimRight?: boolean): string;
}

export interface FindableBuffer {
	readonly length: number;
	getLine(y: number): FindableLine | undefined;
}

export interface TerminalFindBarProps {
	query: string;
	caseSensitive: boolean;
	regex: boolean;
	hasMatch: boolean | null;
	onQueryChange: (query: string) => void;
	onToggle: (option: "caseSensitive" | "regex") => void;
	onNext: () => void;
	onPrevious: () => void;
	onClose: () => void;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternFor(options: TerminalFindOptions): RegExp | null {
	const { query, caseSensitive, regex } = options;
	if (!query) return null;
	try {
		return new RegExp(regex ? query : escapeRegExp(query), caseSensitive ? "g" : "gi");
	} catch {
		return null;
	}
}

function lineTexts(buffer: FindableBuffer): string[] {
	const lines: string[] = [];
	for (let index = 0; index < buffer.length; index += 1) {
		lines.push(buffer.getLine(index)?.translateToString(false) ?? "");
	}
	return lines;
}

function lastMatchBefore(pattern: RegExp, text: string, end: number): RegExpExecArray | null {
	let found: RegExpExecArray | null = null;
	pattern.lastIndex = 0;
	let match = pattern.exec(text);
	while (match) {
		if (match.index >= end) break;
		found = match;
		pattern.lastIndex = match.index + Math.max(1, match[0].length);
		match = pattern.exec(text);
	}
	return found;
}

export function findInTerminalBuffer(
	buffer: FindableBuffer,
	options: TerminalFindOptions,
	from: TerminalFindMatch | null = null,
	direction: TerminalFindDirection = "next",
): TerminalFindMatch | null {
	const pattern = patternFor(options);
	if (!pattern) return null;

	const lines = lineTexts(buffer);
	if (lines.length === 0) return null;

	if (direction === "next") {
		const startLine = from ? Math.max(0, Math.min(from.line, lines.length - 1)) : 0;
		const startColumn = from ? from.column + Math.max(1, from.length) : 0;
		for (let step = 0; step < lines.length; step += 1) {
			const line = (startLine + step) % lines.length;
			const text = lines[line] ?? "";
			const fromColumn = step === 0 ? startColumn : 0;
			pattern.lastIndex = fromColumn;
			const match = pattern.exec(text);
			if (match) {
				return { line, column: match.index, length: match[0].length };
			}
		}
		return null;
	}

	const startLine = from ? Math.max(0, Math.min(from.line, lines.length - 1)) : lines.length - 1;
	const startColumn = from ? from.column : Number.POSITIVE_INFINITY;
	for (let step = 0; step < lines.length; step += 1) {
		const line = (startLine - step + lines.length) % lines.length;
		const text = lines[line] ?? "";
		const end = step === 0 ? startColumn : Number.POSITIVE_INFINITY;
		const match = lastMatchBefore(pattern, text, end);
		if (match) {
			return { line, column: match.index, length: match[0].length };
		}
	}
	return null;
}

export function TerminalFindBar({
	query,
	caseSensitive,
	regex,
	hasMatch,
	onQueryChange,
	onToggle,
	onNext,
	onPrevious,
	onClose,
}: TerminalFindBarProps) {
	return (
		<search
			aria-label="Find in terminal"
			className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border-strong bg-raised p-1 shadow-popover"
		>
			<SearchIcon className="ml-1 shrink-0 text-fg-subtle" />
			<input
				aria-label="Find in terminal"
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						if (event.shiftKey) onPrevious();
						else onNext();
					} else if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					}
				}}
				placeholder="Find"
				spellCheck={false}
				className="h-6 w-40 min-w-0 rounded-sm bg-transparent px-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-focus"
			/>
			{hasMatch === false ? (
				<span aria-live="polite" className="shrink-0 pr-1 text-2xs text-danger">
					No results
				</span>
			) : null}
			<IconButton
				size="xs"
				label="Match case"
				pressed={caseSensitive}
				onClick={() => onToggle("caseSensitive")}
				className={caseSensitive ? "bg-active text-fg" : undefined}
				icon={
					<span aria-hidden="true" className="text-2xs font-medium">
						Aa
					</span>
				}
			/>
			<IconButton
				size="xs"
				label="Use regular expression"
				pressed={regex}
				onClick={() => onToggle("regex")}
				className={regex ? "bg-active text-fg" : undefined}
				icon={
					<span aria-hidden="true" className="text-2xs font-medium">
						.*
					</span>
				}
			/>
			<IconButton
				size="xs"
				label="Previous match"
				onClick={onPrevious}
				icon={<ChevronRightIcon className="-rotate-90" />}
			/>
			<IconButton
				size="xs"
				label="Next match"
				onClick={onNext}
				icon={<ChevronDownIcon className="-rotate-90" />}
			/>
			<IconButton size="xs" label="Close find" onClick={onClose} icon={<CloseIcon />} />
		</search>
	);
}
