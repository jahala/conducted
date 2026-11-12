/**
 * @feature APP-05 File icons
 * Owns: which icon a file gets. A kind in Conductor's brand table gets that table's glyph and tint;
 * every other file gets the Material Icon Theme's icon, from the theme's own manifest.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons"). Conductor 0.92.1 first looks a
 * file up in a hand-made table of about 120 names and extensions, each with a tinted glyph (#534),
 * and only then in the Material Icon Theme (renderApp: the lookup `x8i` @2480863, entered through
 * `cH` @2483266 and `wKe` @2483321). The table reads, in order: the whole text given, in lower case
 * (names @2477214); the Dockerfile prefix, the whole text or the text before a dot (@2478104); the
 * text after the last dot, in lower case (extensions @2478164). It reads the text it is given, so
 * the file tree's bare name can match a name, while the path chip's path matches only by extension.
 * A text with no dot is its own extension there, so a file named `go` gets the Go glyph.
 * The Material lookup (`oNs` @2476375) reads the path's last segment: the whole name, the lower-case
 * name, the text after the first dot, then after the last dot, with the theme's own `html`,
 * `typescript` and `javascript` fallbacks and its `file` icon last.
 * Our design choice (D002): the table below is hand-read from Conductor's tables and written in our
 * own form; the glyphs come from the simple-icons and react-icons packages (see file-icon.tsx), and
 * the manifest and SVGs from the `material-icon-theme` package (MIT), never from Conductor's bundle.
 * Conductor's extension table also lists `env.local`, `env.production` and `env.development`, which
 * its last-dot rule can never reach; they are left out here, which changes nothing anyone sees.
 * Every lookup reads own keys only, so a file named like an object property (`constructor`) gets
 * the theme's file icon.
 * Must handle: either case of a name and an extension, an extension after more than one dot, a
 * dotfile, a path, and a name that matches nothing.
 * Test first: "gives a kind in Conductor's table its glyph and tint".
 */
import manifest from "material-icon-theme/dist/material-icons.json";

/** A glyph Conductor's table draws. Each one's art is chosen in file-icon.tsx. */
export type BrandGlyph =
	| "apache-maven"
	| "bash"
	| "bun"
	| "c"
	| "cpp"
	| "csharp"
	| "css"
	| "deno"
	| "docker"
	| "eslint"
	| "file-archive"
	| "file-audio"
	| "file-code"
	| "file-csv"
	| "file-image"
	| "file-pdf"
	| "file-text"
	| "file-video"
	| "git"
	| "go"
	| "gradle"
	| "html"
	| "java"
	| "javascript"
	| "json"
	| "kotlin"
	| "markdown"
	| "nodejs"
	| "php"
	| "poetry"
	| "prettier"
	| "python"
	| "react"
	| "ruby"
	| "rust"
	| "sass"
	| "settings"
	| "swift"
	| "terraform"
	| "typescript"
	| "vite"
	| "webpack"
	| "yaml";

/** A tint by Conductor's name for it; each is the `--color-file-<tint>` token in styles.css. */
export type BrandTint =
	| "amber-100"
	| "amber-500"
	| "blue-400"
	| "blue-500"
	| "blue-600"
	| "blue-700"
	| "blue-800"
	| "cyan-400"
	| "cyan-600"
	| "documentation"
	| "emerald-600"
	| "gray-600"
	| "gray-900"
	| "green-500"
	| "green-600"
	| "indigo-500"
	| "orange-500"
	| "orange-600"
	| "orange-700"
	| "pink-500"
	| "pink-600"
	| "purple-500"
	| "purple-600"
	| "red-500"
	| "red-600"
	| "red-700"
	| "sky-400"
	| "teal-700"
	| "yellow-400"
	| "yellow-600";

export interface BrandEntry {
	readonly glyph: BrandGlyph;
	readonly tint: BrandTint;
}

/** Which icon a file gets: a tinted glyph from Conductor's table, or a Material icon by name. */
export type FileIcon =
	| { readonly kind: "glyph"; readonly glyph: BrandGlyph; readonly tint: BrandTint }
	| { readonly kind: "material"; readonly icon: string };

const kind = (glyph: BrandGlyph, tint: BrandTint): BrandEntry => ({ glyph, tint });

const typescript = kind("typescript", "blue-600");
const javascript = kind("javascript", "yellow-400");
const react = kind("react", "cyan-400");
const html = kind("html", "orange-600");
const sass = kind("sass", "pink-600");
const json = kind("json", "yellow-600");
const python = kind("python", "blue-500");
const cpp = kind("cpp", "blue-700");
const kotlin = kind("kotlin", "purple-600");
const bash = kind("bash", "green-600");
const yaml = kind("yaml", "red-600");
const config = kind("settings", "gray-600");
const markdown = kind("markdown", "documentation");
const text = kind("file-text", "gray-600");
const image = kind("file-image", "green-500");
const video = kind("file-video", "red-500");
const audio = kind("file-audio", "purple-500");
const archive = kind("file-archive", "amber-500");
const table = kind("file-csv", "emerald-600");
const terraform = kind("terraform", "purple-600");
const header = kind("file-code", "gray-600");
const eslint = kind("eslint", "purple-600");
const prettier = kind("prettier", "pink-500");
const vite = kind("vite", "purple-500");
const git = kind("git", "orange-600");
const rust = kind("rust", "orange-700");
const poetry = kind("poetry", "blue-400");
const gradle = kind("gradle", "teal-700");
const deno = kind("deno", "gray-900");

/** Conductor 0.92.1's brand table, hand-read from renderApp @2477214 to @2480863. */
export const BRAND_TABLE: {
	/** Whole names, in lower case. */
	readonly names: Readonly<Record<string, BrandEntry>>;
	/** The entry for `dockerfile` and any `dockerfile.<anything>`. */
	readonly dockerfile: BrandEntry;
	/** Text after the last dot, in lower case. */
	readonly extensions: Readonly<Record<string, BrandEntry>>;
} = {
	names: {
		"package.json": kind("nodejs", "green-600"),
		"tsconfig.json": typescript,
		"eslint.config.js": eslint,
		".eslintrc.js": eslint,
		".eslintrc.json": eslint,
		".prettierrc": prettier,
		"prettier.config.js": prettier,
		"vite.config.ts": vite,
		"vite.config.js": vite,
		"webpack.config.js": kind("webpack", "sky-400"),
		".gitignore": git,
		".gitattributes": git,
		"cargo.toml": rust,
		"cargo.lock": rust,
		"poetry.lock": poetry,
		"pyproject.toml": poetry,
		"pom.xml": kind("apache-maven", "red-700"),
		"build.gradle": gradle,
		"settings.gradle": gradle,
		"deno.json": deno,
		"deno.jsonc": deno,
		"bun.lockb": kind("bun", "amber-100"),
	},
	dockerfile: kind("docker", "blue-500"),
	extensions: {
		ts: typescript,
		mts: typescript,
		cts: typescript,
		tsx: react,
		js: javascript,
		mjs: javascript,
		cjs: javascript,
		jsx: react,
		html,
		htm: html,
		css: kind("css", "blue-600"),
		scss: sass,
		sass,
		json,
		jsonc: json,
		py: python,
		pyw: python,
		pyi: python,
		rs: rust,
		go: kind("go", "cyan-600"),
		c: kind("c", "blue-800"),
		cpp,
		cc: cpp,
		cxx: cpp,
		"c++": cpp,
		// Conductor draws Simple Icons' `sharp` glyph (the image library's) for C#; file-icon.tsx keeps it.
		cs: kind("csharp", "green-600"),
		java: kind("java", "red-600"),
		php: kind("php", "indigo-500"),
		rb: kind("ruby", "red-600"),
		swift: kind("swift", "orange-500"),
		kt: kotlin,
		kts: kotlin,
		sh: bash,
		bash,
		zsh: bash,
		fish: bash,
		yml: yaml,
		yaml,
		toml: config,
		ini: config,
		cfg: config,
		conf: config,
		env: kind("settings", "yellow-600"),
		md: markdown,
		mdx: markdown,
		txt: text,
		text,
		png: image,
		jpg: image,
		jpeg: image,
		gif: image,
		bmp: image,
		webp: image,
		svg: image,
		ico: image,
		icns: image,
		mp4: video,
		avi: video,
		mov: video,
		wmv: video,
		flv: video,
		webm: video,
		mkv: video,
		mp3: audio,
		wav: audio,
		flac: audio,
		aac: audio,
		ogg: audio,
		m4a: audio,
		zip: archive,
		tar: archive,
		gz: archive,
		rar: archive,
		"7z": archive,
		bz2: archive,
		xz: archive,
		csv: table,
		tsv: table,
		pdf: kind("file-pdf", "red-600"),
		tf: terraform,
		tfvars: terraform,
		h: header,
		hpp: header,
		hxx: header,
	},
};

const FILE_NAMES = manifest.fileNames as Readonly<Record<string, string>>;
const FILE_EXTENSIONS = manifest.fileExtensions as Readonly<Record<string, string>>;

/** A record's own value for a key, never one it inherits (a file may be named `constructor`). */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The last segment of a path, which is the file name the theme looks up. */
function baseName(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

/** The Material Icon Theme's icon name for a file path or name. */
export function fileIconName(path: string): string {
	const name = baseName(path);
	const exact = own(FILE_NAMES, name) ?? own(FILE_NAMES, name.toLowerCase());
	if (exact !== undefined) return exact;

	const firstDot = name.indexOf(".");
	const lastDot = name.lastIndexOf(".");
	const afterFirst = firstDot === -1 ? name : name.slice(firstDot + 1);
	const afterLast = lastDot === -1 ? name : name.slice(lastDot + 1);
	const extension = own(FILE_EXTENSIONS, afterFirst) ?? own(FILE_EXTENSIONS, afterLast);
	if (extension !== undefined) return extension;

	if (name.endsWith(".html")) return "html";
	if (name.endsWith(".ts")) return "typescript";
	if (name.endsWith(".js")) return "javascript";
	return "file";
}

/** Conductor's brand table entry for the text a caller gives, read as Conductor reads it. */
function brandEntry(given: string): BrandEntry | undefined {
	const lower = given.toLowerCase();
	const named = own(BRAND_TABLE.names, lower);
	if (named !== undefined) return named;
	if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return BRAND_TABLE.dockerfile;
	return own(BRAND_TABLE.extensions, lower.slice(lower.lastIndexOf(".") + 1));
}

/** The icon for a file name or path: Conductor's tinted glyph when its table has one, else Material. */
export function fileIcon(nameOrPath: string): FileIcon {
	const brand = brandEntry(nameOrPath);
	return brand === undefined
		? { kind: "material", icon: fileIconName(nameOrPath) }
		: { kind: "glyph", glyph: brand.glyph, tint: brand.tint };
}
