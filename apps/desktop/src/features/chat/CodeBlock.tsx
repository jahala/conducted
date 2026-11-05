/**
 * @feature CHAT-06 Code block
 * Owns: A highlighted code block with a language label and a copy button.
 * Behaviour: ui-map.md 3.3 (code blocks with copy), 8 (Shiki for highlight; CodeBlockMemoized).
 * Our design choice: Highlighting runs through shiki, loaded on first use, and falls back to plain
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

const LARGE_BLOCK = 4000;

interface HighlightToken {
	content: string;
	color: string | undefined;
}

function currentTheme(): "light" | "dark" {
	if (typeof document === "undefined") return "dark";
	const forced = document.documentElement.dataset.theme;
	if (forced === "light" || forced === "dark") return forced;
	if (typeof window === "undefined") return "dark";
	const media = window.matchMedia?.("(prefers-color-scheme: dark)");
	return media?.matches ? "dark" : "light";
}

function useDocumentTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">(currentTheme);
	useEffect(() => {
		const update = () => setTheme(currentTheme());
		const media = window.matchMedia?.("(prefers-color-scheme: dark)");
		media?.addEventListener?.("change", update);
		const observer =
			typeof MutationObserver === "undefined" ? null : new MutationObserver(() => update());
		observer?.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => {
			media?.removeEventListener?.("change", update);
			observer?.disconnect();
		};
	}, []);
	return theme;
}

export interface CodeBlockProps {
	code: string;
	language: string | null;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
	const actions = useActions();
	const theme = useDocumentTheme();
	const [tokens, setTokens] = useState<HighlightToken[][] | null>(null);
	const [showAll, setShowAll] = useState(false);
	const tooLarge = code.length > LARGE_BLOCK && !showAll;
	const shown = tooLarge ? code.slice(0, LARGE_BLOCK) : code;

	useEffect(() => {
		let cancelled = false;
		setTokens(null);
		if (language === null || language.length === 0) return;
		const lang: string = language;
		async function highlight() {
			try {
				const { codeToTokens } = await import("shiki");
				const rendered = await codeToTokens(shown, {
					lang: lang as never,
					theme: theme === "dark" ? "github-dark" : "github-light",
				});
				if (!cancelled) {
					setTokens(
						rendered.tokens.map((line) =>
							line.map((token) => ({ content: token.content, color: token.color })),
						),
					);
				}
			} catch {
				if (!cancelled) setTokens(null);
			}
		}
		void highlight();
		return () => {
			cancelled = true;
		};
	}, [shown, language, theme]);

	let offset = 0;
	const highlighted =
		tokens === null
			? null
			: tokens.map((line) => {
					const lineKey = `line-${offset}`;
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
					return (
						<span key={lineKey} className="block">
							{cells.length === 0 ? " " : cells}
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
					<code>{highlighted ?? shown}</code>
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
