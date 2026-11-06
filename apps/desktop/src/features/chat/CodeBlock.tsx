/**
 * @feature CHAT-06 Code block
 * Owns: A highlighted code block with a language label and a copy button.
 * Behaviour: ui-map.md 3.3 (code blocks with copy), 8 (Shiki for highlight; CodeBlockMemoized).
 * Our design choice: Highlighting runs through shiki, loaded on first use, and shows plain
 * monospace text while it loads. Themes follow the app's light or dark mode.
 * Must handle: Unknown language (plain text); a very large block (cut off with 'Show all');
 * streaming code (re-highlight without flicker, memoised on the text); copy confirms with a short
 * 'Copied' label; horizontal scroll, no wrapping.
 * Test first: Renders the code text for an unknown language and the copy button copies exactly that
 * text.
 */
import { useEffect, useState } from "react";
import { useActions } from "../../core/hooks.ts";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";

const LARGE_BLOCK = 4000;

interface HighlightToken {
	content: string;
	color: string | undefined;
}

export interface CodeBlockProps {
	code: string;
	language: string | null;
}

/** Highlighted tokens and the exact text they were made from. */
interface Highlighted {
	source: string;
	lines: HighlightToken[][];
}

export function CodeBlock({ code, language }: CodeBlockProps) {
	const actions = useActions();
	const theme = useThemeType();
	const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
	const [showAll, setShowAll] = useState(false);
	const tooLarge = code.length > LARGE_BLOCK && !showAll;
	const shown = tooLarge ? code.slice(0, LARGE_BLOCK) : code;

	useEffect(() => {
		let cancelled = false;
		if (language === null || language.length === 0) {
			setHighlighted(null);
			return;
		}
		const lang: string = language;
		async function highlight() {
			try {
				const { codeToTokens } = await import("shiki");
				const rendered = await codeToTokens(shown, {
					lang: lang as never,
					theme: theme === "dark" ? "github-dark" : "github-light",
				});
				if (!cancelled) {
					setHighlighted({
						source: shown,
						lines: rendered.tokens.map((line) =>
							line.map((token) => ({ content: token.content, color: token.color })),
						),
					});
				}
			} catch {
				// An unknown language or a failed load leaves the plain text, which is already on screen.
				if (!cancelled) setHighlighted(null);
			}
		}
		void highlight();
		return () => {
			cancelled = true;
		};
	}, [shown, language, theme]);

	// While a reply streams, the text grows after the last highlight. The old colours stay and the new tail
	// shows as plain text until the next highlight arrives, so the block never flashes back to plain.
	const known = highlighted !== null && shown.startsWith(highlighted.source) ? highlighted : null;
	const tail = known === null ? "" : shown.slice(known.source.length);
	let offset = 0;
	const coloured =
		known === null
			? null
			: known.lines.map((line, lineIndex) => {
					const cells = line.map((token) => {
						const key = `token-${offset}`;
						offset += token.content.length;
						return (
							<span
								key={key}
								style={token.color === undefined ? undefined : { color: token.color }}
							>
								{token.content}
							</span>
						);
					});
					const lineKey = `line-${offset}-${lineIndex}`;
					offset += 1;
					return (
						<span key={lineKey}>
							{cells}
							{lineIndex < known.lines.length - 1 ? "\n" : ""}
						</span>
					);
				});

	return (
		<div className="my-3 overflow-hidden rounded-lg border border-border bg-surface">
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
				<span className="font-mono text-2xs text-fg-muted">{language ?? "text"}</span>
				<CopyButton
					text={code}
					onCopy={(text) => actions.app.copyText(text)}
					label="Copy"
					className="h-6 px-2 text-2xs"
				/>
			</div>
			<div className="overflow-x-auto">
				<pre className="m-0 p-3 font-mono text-code text-fg">
					<code>
						{coloured ?? shown}
						{tail}
					</code>
				</pre>
			</div>
			{tooLarge ? (
				<div className="border-t border-border px-3 py-1.5">
					<button
						type="button"
						onClick={() => setShowAll(true)}
						className="text-xs font-medium text-link hover:underline"
					>
						Show all
					</button>
				</div>
			) : null}
		</div>
	);
}
