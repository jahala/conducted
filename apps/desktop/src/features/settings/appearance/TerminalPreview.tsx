/**
 * @feature SET-06 Terminal preview
 * Owns: a static block of terminal text drawn with the chosen terminal font and size, naming the
 * sixteen ANSI colours in the colour of their token.
 * Behaviour: ui-map.md 6 (Appearance page, terminal preview block); ui-map.md 8 (terminal colour
 * tokens).
 * Our design choice: plain DOM text with token colours, not a live xterm, so the page stays light.
 * Must handle: a font size change applying at once, a missing font (the Menlo-first fallback list),
 * and theme switches (the colour tokens are light-dark()).
 * Test first: the preview shows all sixteen colour names once.
 */
import {
	DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE,
	TERMINAL_THEME_TOKENS,
} from "../../terminal/terminal-theme.ts";

export interface TerminalPreviewProps {
	fontFamily: string;
	fontSize: number;
}

const ANSI_COLOURS = TERMINAL_THEME_TOKENS.filter((token) => token.startsWith("--color-term-"));

function colourName(token: string): string {
	const name = token.replace("--color-term-", "").replace(/-/g, " ");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function fontFamilyFor(fontFamily: string): string {
	const chosen = fontFamily.trim();
	return chosen === ""
		? DEFAULT_TERMINAL_FONT_FAMILY
		: `${chosen}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

function fontSizeFor(fontSize: number): number {
	return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_TERMINAL_FONT_SIZE;
}

export function TerminalPreview({ fontFamily, fontSize }: TerminalPreviewProps) {
	const size = fontSizeFor(fontSize);
	return (
		<figure
			aria-label="Terminal preview"
			className="flex flex-col overflow-hidden rounded-lg border border-border bg-canvas"
		>
			<figcaption className="border-b border-border px-3 py-1.5 text-2xs font-medium text-fg-muted">
				Terminal
			</figcaption>
			<pre
				className="m-0 overflow-x-auto p-3 text-fg"
				style={{ fontFamily: fontFamilyFor(fontFamily), fontSize: size, lineHeight: 1.2 }}
			>
				<span className="text-fg-muted">$ conducted --preview</span>
				{ANSI_COLOURS.map((token) => (
					<span
						key={token}
						data-colour={token}
						className="block"
						style={{ color: `var(${token})` }}
					>
						{colourName(token)}
					</span>
				))}
			</pre>
		</figure>
	);
}
