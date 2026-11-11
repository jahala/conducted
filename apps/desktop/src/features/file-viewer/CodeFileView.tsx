/**
 * @feature REV-08 Whole-file code view
 * Owns: a read-only, scrollable view of one text file: Shiki colours from the user's code theme,
 * line numbers, wrapping, ligatures and the app's light or dark mode.
 * Behaviour: ui-map.md 3.2 (the whole-file view of the File tab); ui-map.md 8 (Shiki for highlight;
 * the code theme setting colours code and diffs).
 * Renderer reference: `File` from "@pierre/diffs/react" draws one file with line numbers, and takes
 * the same `theme`, `themeType`, `overflow` and `unsafeCSS` options as the diff.
 * Must handle: a named code theme used outside its mode (the Default theme), a very long file (the
 * renderer's own virtualisation), wrapping on and off, ligatures on and off, and a theme change
 * while the file is open.
 * Test first: a .rs file renders coloured token spans and a line number for each line.
 */
import { File } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useSetting } from "../../core/hooks.ts";
import { useThemeType } from "../../ui/use-theme-type.ts";
import { NO_LIGATURES_CSS } from "../diff/diff-options.ts";
import { diffThemeFor } from "../diff/diff-theme.ts";

export interface CodeFileViewProps {
	path: string;
	text: string;
}

export function CodeFileView({ path, text }: CodeFileViewProps) {
	const wrapLines = useSetting<boolean>("wrap_lines");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const codeTheme = useSetting<string>("code_theme");
	const themeType = useThemeType();
	const options = useMemo(
		() => ({
			theme: diffThemeFor(codeTheme, themeType).name,
			themeType,
			disableFileHeader: true,
			overflow: wrapLines ? ("wrap" as const) : ("scroll" as const),
			...(ligatures ? {} : { unsafeCSS: NO_LIGATURES_CSS }),
		}),
		[codeTheme, themeType, wrapLines, ligatures],
	);

	return (
		<div className="h-full min-h-0 overflow-auto" data-code-view>
			<File file={{ name: path, contents: text }} options={options} />
		</div>
	);
}
