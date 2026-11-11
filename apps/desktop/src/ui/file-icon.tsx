/**
 * @feature APP-05 File icons
 * Owns: the language icon beside a file name in the file tree, a file tab and the file path chip,
 * and the colour that icon takes.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons"), 3.2 and 8 (Conductor shows the
 * file's language icon in the path chip and on each file). Measured from Conductor 0.92.1
 * (renderApp @2477220, @2480863): a language has its own icon and tint; an unknown file gets the
 * generic document icon. The language itself comes from file-language.ts; the colours are the
 * app's file-icon tokens in styles.css.
 * Our design choice (D002): every glyph is drawn here, not copied from Conductor's Material set. A
 * language uses a short mark or a simple shape of its own: a gear for Rust, an atom for React, a
 * terminal prompt for shell, braces for JSON, and a lettered badge otherwise.
 * Must handle: every language file-language.ts can return, and a folder, open or closed.
 * Test first: "shows the rust icon for src/main.rs".
 */
import type { SVGProps } from "react";
import { type FileLanguage, fileLanguage } from "./file-language.ts";

const TONES: Readonly<Record<FileLanguage, string>> = {
	typescript: "text-file-blue",
	tsx: "text-file-cyan",
	javascript: "text-file-yellow",
	jsx: "text-file-cyan",
	rust: "text-file-orange",
	python: "text-file-blue",
	go: "text-file-cyan",
	java: "text-file-red",
	ruby: "text-file-red",
	php: "text-file-purple",
	swift: "text-file-orange",
	kotlin: "text-file-purple",
	c: "text-file-blue",
	cpp: "text-file-blue",
	csharp: "text-file-green",
	shell: "text-file-green",
	html: "text-file-orange",
	css: "text-file-blue",
	sass: "text-file-pink",
	json: "text-file-yellow",
	yaml: "text-file-red",
	toml: "text-file-gray",
	markdown: "text-file-gray",
	image: "text-file-green",
	video: "text-file-red",
	audio: "text-file-purple",
	archive: "text-file-yellow",
	pdf: "text-file-red",
	csv: "text-file-green",
	lock: "text-file-gray",
	text: "text-file-gray",
	file: "text-fg-muted",
	folder: "text-fg-muted",
	"folder-open": "text-fg-muted",
};

/** A rounded badge with a short mark, the shape most languages take here. */
function Badge({ label, size = 7 }: { label: string; size?: number }) {
	return (
		<>
			<rect x="1.5" y="1.5" width="13" height="13" rx="3" strokeWidth="1.2" />
			<text
				x="8"
				y="10.9"
				textAnchor="middle"
				fontSize={size}
				fontWeight="700"
				fontFamily="ui-sans-serif, system-ui, sans-serif"
				fill="currentColor"
				stroke="none"
			>
				{label}
			</text>
		</>
	);
}

function Glyph({ language }: { language: FileLanguage }) {
	switch (language) {
		case "rust":
			return (
				<>
					<circle cx="8" cy="8" r="2.2" />
					<path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
					<circle cx="8" cy="8" r="5.2" strokeDasharray="1.4 1.6" />
				</>
			);
		case "tsx":
		case "jsx":
			return (
				<>
					<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
					<ellipse cx="8" cy="8" rx="6" ry="2.4" />
					<ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(60 8 8)" />
					<ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(120 8 8)" />
				</>
			);
		case "typescript":
			return <Badge label="TS" size={6.4} />;
		case "javascript":
			return <Badge label="JS" size={6.4} />;
		case "python":
			return <Badge label="Py" size={6.4} />;
		case "go":
			return <Badge label="Go" size={6.4} />;
		case "java":
			return <Badge label="J" />;
		case "ruby":
			return <path d="M8 2l6 6-6 6-6-6z" />;
		case "php":
			return <Badge label="php" size={5.4} />;
		case "swift":
			return <path d="M3 4c3 0 6 2 8 5-1.5 2-4 3.5-7 3.5L6.5 10 4 11z" />;
		case "kotlin":
			return <path d="M3 2h10L8 8l5 6H3z" />;
		case "c":
			return <Badge label="C" />;
		case "cpp":
			return <Badge label="C++" size={5} />;
		case "csharp":
			return <Badge label="C#" size={5.2} />;
		case "shell":
			return (
				<>
					<rect x="1.5" y="2.5" width="13" height="11" rx="2" />
					<path d="M4.5 6l2 2-2 2M8.5 10h3" />
				</>
			);
		case "html":
			return <path d="M5.5 4L2.5 8l3 4M10.5 4l3 4-3 4" />;
		case "css":
			return <Badge label="#" />;
		case "sass":
			return <Badge label="S" />;
		case "json":
			return <Badge label="{}" size={5.4} />;
		case "yaml":
			return <Badge label="Y" />;
		case "toml":
			return (
				<>
					<circle cx="8" cy="8" r="2" />
					<path d="M6.9 2.5h2.2l.4 1.6 1.2.7 1.6-.5 1.1 1.9-1.2 1.1v1.4l1.2 1.1-1.1 1.9-1.6-.5-1.2.7-.4 1.6H6.9l-.4-1.6-1.2-.7-1.6.5-1.1-1.9 1.2-1.1V7.3L2.6 6.2l1.1-1.9 1.6.5 1.2-.7z" />
				</>
			);
		case "markdown":
			return <Badge label="M↓" size={5.6} />;
		case "image":
			return (
				<>
					<rect x="2" y="3" width="12" height="10" rx="1.5" />
					<circle cx="5.5" cy="6" r="1" fill="currentColor" stroke="none" />
					<path d="M2.5 11l3-3 2.5 2.5L11 7l2.5 3" />
				</>
			);
		case "video":
			return (
				<>
					<rect x="2" y="3" width="12" height="10" rx="2" />
					<path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
				</>
			);
		case "audio":
			return <path d="M6 11.5V5l6-1.5v6.5M6 11.5a2 1.5 0 1 1-2-1.4M12 10a2 1.5 0 1 1-2-1.4" />;
		case "archive":
			return (
				<>
					<rect x="2" y="3" width="12" height="10" rx="1.5" />
					<path d="M2 6.5h12M7 3v3.5M9 6.5v3M7 9.5v3" />
				</>
			);
		case "pdf":
			return <Badge label="PDF" size={4.8} />;
		case "csv":
			return (
				<>
					<rect x="2" y="3" width="12" height="10" rx="1.5" />
					<path d="M2 6.5h12M6 3v10M10 3v10" />
				</>
			);
		case "lock":
			return (
				<>
					<rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
					<path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
				</>
			);
		case "folder":
			return <path d="M2 4.5h4l1.5 1.5H14v7H2z" />;
		case "folder-open":
			return <path d="M2 4.5h4l1.5 1.5H14v2H4.5L2 13zM4.5 8H14l-1.5 5H2z" />;
		default:
			return (
				<>
					<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />
					{language === "text" ? <path d="M6 8h4M6 10.5h4" /> : null}
				</>
			);
	}
}

export interface FileTypeIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
	path: string;
	isDirectory?: boolean;
	expanded?: boolean;
}

/** The language icon and colour for a path. Decorative: the file's name carries the meaning. */
export function FileTypeIcon({
	path,
	isDirectory = false,
	expanded = false,
	className,
	...rest
}: FileTypeIconProps) {
	const language: FileLanguage = isDirectory
		? expanded
			? "folder-open"
			: "folder"
		: fileLanguage(path);
	return (
		<span
			data-file-icon
			data-kind={language}
			className={`inline-flex shrink-0 items-center justify-center ${TONES[language]}`}
		>
			<svg
				viewBox="0 0 16 16"
				width="16"
				height="16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className={className ?? "size-4"}
				{...rest}
			>
				<Glyph language={language} />
			</svg>
		</span>
	);
}
