/**
 * @feature APP-05 File language
 * Owns: which language a path belongs to, from its exact name or its extension, for the file icon
 * and the editor's Shiki highlighting.
 * Behaviour: ui-map.md 3.6 and 8 (Conductor picks a file's icon and highlight language from its
 * name and extension). Measured from Conductor 0.92.1 (renderApp @2477220, @2480863).
 * Our design choice (D002): the languages and their aliases are listed here in our own words; no
 * Conductor asset or table is copied.
 * Must handle: an exact file name (package.json, Cargo.toml, .gitignore), upper-case extensions, a
 * dotfile with no extension, an extension with no language (.bin), and a path with no folder.
 * Test first: "reads src/main.rs as rust and README.md as markdown".
 */
export type FileLanguage =
	| "typescript"
	| "tsx"
	| "javascript"
	| "jsx"
	| "rust"
	| "python"
	| "go"
	| "java"
	| "ruby"
	| "php"
	| "swift"
	| "kotlin"
	| "c"
	| "cpp"
	| "csharp"
	| "shell"
	| "html"
	| "css"
	| "sass"
	| "json"
	| "yaml"
	| "toml"
	| "markdown"
	| "image"
	| "video"
	| "audio"
	| "archive"
	| "pdf"
	| "csv"
	| "lock"
	| "text"
	| "file"
	| "folder"
	| "folder-open";

const BY_NAME: Readonly<Record<string, FileLanguage>> = {
	"package.json": "javascript",
	"tsconfig.json": "typescript",
	"cargo.toml": "rust",
	"cargo.lock": "rust",
	dockerfile: "shell",
	makefile: "shell",
	".gitignore": "file",
	".gitattributes": "file",
	"pyproject.toml": "python",
	"poetry.lock": "python",
};

const BY_EXTENSION: Readonly<Record<string, FileLanguage>> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	rs: "rust",
	py: "python",
	pyw: "python",
	pyi: "python",
	go: "go",
	java: "java",
	rb: "ruby",
	php: "php",
	swift: "swift",
	kt: "kotlin",
	kts: "kotlin",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	cs: "csharp",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	html: "html",
	htm: "html",
	css: "css",
	scss: "sass",
	sass: "sass",
	less: "sass",
	json: "json",
	jsonc: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	ini: "toml",
	cfg: "toml",
	conf: "toml",
	env: "toml",
	md: "markdown",
	markdown: "markdown",
	mdx: "markdown",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
	svg: "image",
	ico: "image",
	icns: "image",
	mp4: "video",
	avi: "video",
	mov: "video",
	wmv: "video",
	flv: "video",
	webm: "video",
	mkv: "video",
	mp3: "audio",
	wav: "audio",
	flac: "audio",
	aac: "audio",
	ogg: "audio",
	m4a: "audio",
	zip: "archive",
	tar: "archive",
	gz: "archive",
	rar: "archive",
	"7z": "archive",
	bz2: "archive",
	xz: "archive",
	pdf: "pdf",
	csv: "csv",
	tsv: "csv",
	lock: "lock",
	txt: "text",
	text: "text",
};

/** The language whose icon and colour a path shows. */
export function fileLanguage(path: string): FileLanguage {
	const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	const exact = BY_NAME[name];
	if (exact !== undefined) return exact;
	if (name === "dockerfile" || name.startsWith("dockerfile.")) return "shell";
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "file";
	return BY_EXTENSION[name.slice(dot + 1)] ?? "file";
}
