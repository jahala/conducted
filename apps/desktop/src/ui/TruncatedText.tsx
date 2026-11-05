/**
 * @feature APP-13 TruncatedText
 * Owns: one line of text that keeps its beginning and its end, with the full value on hover and a copy button.
 * Behaviour: ui-map.md 8 (TruncatedText in the feedback group, middle truncation with copy);
 * ui-dimensions.md 8 (paths and identifiers in cards).
 * Our design choice: the shortening happens in JavaScript so the middle survives, not just the tail that
 * CSS `text-overflow` keeps. Shortening counts code points, so an emoji or a non-Latin character is never
 * split in half. The full text stays in `title` and in the accessible copy action.
 * Must handle: text shorter than the limit (unchanged); a limit of one or zero; the copy action missing
 * (no button); the full value, not the shortened one, being copied.
 * Test first: a long path keeps its start and its end around an ellipsis and copies its full value.
 */
import { CopyButton } from "./CopyButton.tsx";
import { cn } from "./cn.ts";

export const DEFAULT_TRUNCATE_LENGTH = 60;

/** Shortens around the middle, keeping `maxLength` code points in the result including the ellipsis. */
export function truncateMiddle(text: string, maxLength = DEFAULT_TRUNCATE_LENGTH): string {
	if (maxLength <= 0) return "";
	if (maxLength === 1) return "…";
	const characters = Array.from(text);
	if (characters.length <= maxLength) return text;
	const keep = maxLength - 1;
	const head = Math.ceil(keep / 2);
	const tail = Math.floor(keep / 2);
	const end = tail > 0 ? characters.slice(-tail).join("") : "";
	return `${characters.slice(0, head).join("")}…${end}`;
}

export interface TruncatedTextProps {
	text: string;
	maxLength?: number;
	/** Supplying this shows the copy button; it receives the full text. */
	onCopy?: (text: string) => unknown;
	copiedMs?: number;
	className?: string;
}

export function TruncatedText({
	text,
	maxLength = DEFAULT_TRUNCATE_LENGTH,
	onCopy,
	copiedMs,
	className,
}: TruncatedTextProps) {
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
			<span title={text} className="selectable min-w-0 truncate">
				{truncateMiddle(text, maxLength)}
			</span>
			{onCopy ? (
				<CopyButton text={text} onCopy={onCopy} copiedMs={copiedMs} variant="ghost" size="xs" />
			) : null}
		</span>
	);
}
