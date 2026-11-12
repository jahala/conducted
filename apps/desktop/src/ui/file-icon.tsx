/**
 * @feature APP-05 File icons
 * Owns: drawing a file's icon at the size a caller asks for: a tinted glyph for a kind in Conductor's
 * brand table, or the Material Icon Theme's SVG for any other file.
 * Behaviour: ui-map.md 3.6 and 3.2 (the All files tree, the file tab and the file path chip show the
 * file's own icon). Conductor 0.92.1 draws a table kind as an inline SVG glyph in `currentColor` with
 * the tint's text colour (renderApp `w8i` @2483097, `mA` @2483400, glyphs `gNs` @2481361), and any
 * other file as the theme's SVG at /material-icons/<icon>.svg on an image (@2483068).
 * Our design choice (D002): no art comes from Conductor's bundle. Conductor's glyphs come from
 * react-icons 5.5.0; each one was matched path for path against its upstream release:
 * - 32 brand glyphs are Simple Icons (CC0). They come from the `simple-icons` package, pinned at
 *   14.15.0: every 14.x release draws all 32 exactly as Conductor does, while 13.0.0 and 15.0.0
 *   each differ in one.
 * - 11 shapes are not Simple Icons, so they come from react-icons 5.5.0 itself, pinned because
 *   5.6.0 and 5.7.0 redraw some of them: Font Awesome 5's solid file shapes (CC BY 4.0), the VS Code
 *   codicons `json` and `settings-gear` (CC BY 4.0, codicons 0.0.40), and Devicons' `java` (MIT).
 * Each glyph is imported by name, so the build keeps only these 43. The Material SVGs come from the
 * `material-icon-theme` package (MIT).
 * Must handle: a file the theme has no name for (its `file` icon), any of the theme's icon names,
 * every glyph and tint in the table, light and dark (one tint changes with the theme), and a missing
 * label (the icon is decorative, so the row's text names it).
 * Test first: "draws the Simple Icons glyph in Conductor's tint for the issue's four kinds".
 */
import type { ReactNode, SVGProps } from "react";
import { DiJava } from "react-icons/di";
import {
	FaFileAlt,
	FaFileArchive,
	FaFileAudio,
	FaFileCode,
	FaFileCsv,
	FaFileImage,
	FaFilePdf,
	FaFileVideo,
} from "react-icons/fa";
import { VscJson, VscSettingsGear } from "react-icons/vsc";
import {
	type SimpleIcon,
	siApachemaven,
	siBun,
	siC,
	siCplusplus,
	siCss3,
	siDeno,
	siDocker,
	siEslint,
	siGit,
	siGnubash,
	siGo,
	siGradle,
	siHtml5,
	siJavascript,
	siKotlin,
	siMarkdown,
	siNodedotjs,
	siPhp,
	siPoetry,
	siPrettier,
	siPython,
	siReact,
	siRuby,
	siRust,
	siSass,
	siSharp,
	siSwift,
	siTerraform,
	siTypescript,
	siVite,
	siWebpack,
	siYaml,
} from "simple-icons";
import { cn } from "./cn.ts";
import { type BrandGlyph, type BrandTint, fileIcon } from "./file-icon.ts";

const ICON_URLS = import.meta.glob<string>("../../node_modules/material-icon-theme/icons/*.svg", {
	eager: true,
	query: "?url",
	import: "default",
});

/** The package's icon URLs by icon name, without the folder or `.svg` suffix. */
const ICON_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(ICON_URLS).map(([file, url]) => [
		file.slice(file.lastIndexOf("/") + 1, -".svg".length),
		url,
	]),
);

/** A glyph drawn as an SVG in `currentColor`, given the attributes the icon sets. */
type Glyph = (props: SVGProps<SVGSVGElement>) => ReactNode;

/** A Simple Icons glyph on its 24-unit grid, drawn the way react-icons draws one. */
function simpleIcon(icon: SimpleIcon): Glyph {
	return (props) => (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="currentColor"
			aria-hidden="true"
			focusable="false"
			{...props}
		>
			<path d={icon.path} />
		</svg>
	);
}

/** Each glyph's art. Conductor's `csharp` is Simple Icons' `sharp`, kept as Conductor draws it. */
const GLYPHS: Readonly<Record<BrandGlyph, Glyph>> = {
	"apache-maven": simpleIcon(siApachemaven),
	bash: simpleIcon(siGnubash),
	bun: simpleIcon(siBun),
	c: simpleIcon(siC),
	cpp: simpleIcon(siCplusplus),
	csharp: simpleIcon(siSharp),
	css: simpleIcon(siCss3),
	deno: simpleIcon(siDeno),
	docker: simpleIcon(siDocker),
	eslint: simpleIcon(siEslint),
	"file-archive": FaFileArchive,
	"file-audio": FaFileAudio,
	"file-code": FaFileCode,
	"file-csv": FaFileCsv,
	"file-image": FaFileImage,
	"file-pdf": FaFilePdf,
	"file-text": FaFileAlt,
	"file-video": FaFileVideo,
	git: simpleIcon(siGit),
	go: simpleIcon(siGo),
	gradle: simpleIcon(siGradle),
	html: simpleIcon(siHtml5),
	java: DiJava,
	javascript: simpleIcon(siJavascript),
	json: VscJson,
	kotlin: simpleIcon(siKotlin),
	markdown: simpleIcon(siMarkdown),
	nodejs: simpleIcon(siNodedotjs),
	php: simpleIcon(siPhp),
	poetry: simpleIcon(siPoetry),
	prettier: simpleIcon(siPrettier),
	python: simpleIcon(siPython),
	react: simpleIcon(siReact),
	ruby: simpleIcon(siRuby),
	rust: simpleIcon(siRust),
	sass: simpleIcon(siSass),
	settings: VscSettingsGear,
	swift: simpleIcon(siSwift),
	terraform: simpleIcon(siTerraform),
	typescript: simpleIcon(siTypescript),
	vite: simpleIcon(siVite),
	webpack: simpleIcon(siWebpack),
	yaml: simpleIcon(siYaml),
};

/** Each tint's text colour class, from its `--color-file-<tint>` token in styles.css. */
const TINT_CLASS: Readonly<Record<BrandTint, string>> = {
	"amber-100": "text-file-amber-100",
	"amber-500": "text-file-amber-500",
	"blue-400": "text-file-blue-400",
	"blue-500": "text-file-blue-500",
	"blue-600": "text-file-blue-600",
	"blue-700": "text-file-blue-700",
	"blue-800": "text-file-blue-800",
	"cyan-400": "text-file-cyan-400",
	"cyan-600": "text-file-cyan-600",
	documentation: "text-file-documentation",
	"emerald-600": "text-file-emerald-600",
	"gray-600": "text-file-gray-600",
	"gray-900": "text-file-gray-900",
	"green-500": "text-file-green-500",
	"green-600": "text-file-green-600",
	"indigo-500": "text-file-indigo-500",
	"orange-500": "text-file-orange-500",
	"orange-600": "text-file-orange-600",
	"orange-700": "text-file-orange-700",
	"pink-500": "text-file-pink-500",
	"pink-600": "text-file-pink-600",
	"purple-500": "text-file-purple-500",
	"purple-600": "text-file-purple-600",
	"red-500": "text-file-red-500",
	"red-600": "text-file-red-600",
	"red-700": "text-file-red-700",
	"sky-400": "text-file-sky-400",
	"teal-700": "text-file-teal-700",
	"yellow-400": "text-file-yellow-400",
	"yellow-600": "text-file-yellow-600",
};

export interface FileTypeIconProps {
	/** The file's name or path. The file tree passes the name and the path chip the path, as in Conductor. */
	path: string;
	className?: string;
}

/** A file's icon as Conductor draws it: a tinted glyph for a table kind, else the theme's image. */
export function FileTypeIcon({ path, className }: FileTypeIconProps) {
	const icon = fileIcon(path);
	if (icon.kind === "glyph") {
		const Glyph = GLYPHS[icon.glyph];
		return (
			<Glyph
				aria-hidden="true"
				focusable="false"
				data-file-icon={icon.glyph}
				className={cn("shrink-0", TINT_CLASS[icon.tint], className)}
			/>
		);
	}
	return (
		<img
			src={ICON_BY_NAME[icon.icon] ?? ICON_BY_NAME.file}
			alt=""
			aria-hidden="true"
			draggable={false}
			data-file-icon={icon.icon}
			className={cn("shrink-0 object-contain", className)}
		/>
	);
}
