/**
 * @feature APP-05 File icons
 * Owns: which icon the Material Icon Theme gives a file, from the theme's own manifest.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons"); Conductor 0.92.1 resolves a file's
 * icon from the theme's `fileNames` and `fileExtensions` (renderApp @2476730), in that order: the
 * whole name, the lower-case name, the text after the first dot, then after the last dot, with the
 * theme's own `html`, `typescript` and `javascript` fallbacks and its `file` icon last.
 * Our design choice (D002): the manifest and the SVGs come from the `material-icon-theme` package
 * (MIT), never from Conductor's bundle. The manifest is the theme's data, not a table of ours.
 * Must handle: an exact name (package.json, .gitignore), either case of a name and an extension, an
 * extension after more than one dot, a dotfile, and a name that matches nothing.
 * Test first: "maps the issue's four kinds through the theme's manifest".
 */
import manifest from "material-icon-theme/dist/material-icons.json";

const FILE_NAMES = manifest.fileNames as Readonly<Record<string, string>>;
const FILE_EXTENSIONS = manifest.fileExtensions as Readonly<Record<string, string>>;

/** The last segment of a path, which is the file name the theme looks up. */
function baseName(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

/** The Material Icon Theme's icon name for a file path or name. */
export function fileIconName(path: string): string {
	const name = baseName(path);
	const exact = FILE_NAMES[name] ?? FILE_NAMES[name.toLowerCase()];
	if (exact !== undefined) return exact;

	const firstDot = name.indexOf(".");
	const lastDot = name.lastIndexOf(".");
	const afterFirst = firstDot === -1 ? name : name.slice(firstDot + 1);
	const afterLast = lastDot === -1 ? name : name.slice(lastDot + 1);
	const extension = FILE_EXTENSIONS[afterFirst] ?? FILE_EXTENSIONS[afterLast];
	if (extension !== undefined) return extension;

	if (name.endsWith(".html")) return "html";
	if (name.endsWith(".ts")) return "typescript";
	if (name.endsWith(".js")) return "javascript";
	return "file";
}
