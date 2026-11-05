/**
 * @feature REV-01 Changed file tree model
 * Owns: pure functions that turn the flat changed-file list into what the list renders: filtered,
 * sorted, and optionally grouped into folders.
 * Behaviour: ui-map.md 3.6, Changes paragraph ("Filter changed files", "Show flat list" or "Show
 * folder hierarchy"). Conflicted files come first (research: conflict badge; the ordering is
 * Our design choice).
 * Must handle: an empty list, a filter that matches the path or the old path of a renamed file,
 * case-insensitive matching, folders that hold one child folder merged into one node, stable
 * order between calls so the list does not jump, and paths with no folder.
 * Test first: ["src/a/x.ts", "src/a/y.ts", "README.md"] in folder view gives one folder node
 * "src/a" with two files, then README.md.
 */
import type { ChangedFile } from "../../../core/api.ts";

export type ChangedTreeNode =
	| { kind: "file"; file: ChangedFile; depth: number }
	| {
			kind: "folder";
			/** Joined path of a merged chain, e.g. "src/features/diff". */
			path: string;
			depth: number;
			linesAdded: number;
			linesRemoved: number;
	  };

/** Filters on the whole path, and on the old path of a renamed file, ignoring case. */
export function filterChangedFiles(files: ChangedFile[], query: string): ChangedFile[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...files];
	return files.filter(
		(file) =>
			file.path.toLowerCase().includes(needle) || file.oldPath?.toLowerCase().includes(needle),
	);
}

interface Folder {
	name: string;
	path: string;
	files: ChangedFile[];
	folders: Map<string, Folder>;
}

const makeFolder = (name: string, path: string): Folder => ({
	name,
	path,
	files: [],
	folders: new Map(),
});

const segmentsOf = (path: string): string[] =>
	path
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

/** Conflicted files first, then by path. Comparing the path keeps the order stable between calls. */
const compareFiles = (left: ChangedFile, right: ChangedFile): number => {
	if (left.conflicted !== right.conflicted) return left.conflicted ? -1 : 1;
	return left.path.localeCompare(right.path);
};

const compareFolders = (left: Folder, right: Folder): number => left.name.localeCompare(right.name);

interface Totals {
	linesAdded: number;
	linesRemoved: number;
}

function totalOf(folder: Folder, cache: Map<Folder, Totals>): Totals {
	const cached = cache.get(folder);
	if (cached !== undefined) return cached;
	let linesAdded = 0;
	let linesRemoved = 0;
	for (const file of folder.files) {
		linesAdded += file.linesAdded;
		linesRemoved += file.linesRemoved;
	}
	for (const child of folder.folders.values()) {
		const totals = totalOf(child, cache);
		linesAdded += totals.linesAdded;
		linesRemoved += totals.linesRemoved;
	}
	const totals = { linesAdded, linesRemoved };
	cache.set(folder, totals);
	return totals;
}

function insert(root: Folder, file: ChangedFile): void {
	const segments = segmentsOf(file.path);
	const name = segments.pop();
	if (name === undefined) return;
	let folder = root;
	for (const segment of segments) {
		let child = folder.folders.get(segment);
		if (child === undefined) {
			child = makeFolder(segment, folder.path.length === 0 ? segment : `${folder.path}/${segment}`);
			folder.folders.set(segment, child);
		}
		folder = child;
	}
	folder.files.push(file);
}

/**
 * A folder with no files of its own and one child folder is shown as one chain ("src/features/
 * diff"). Returns the deepest folder of such a chain.
 */
function collapseChain(folder: Folder): Folder {
	let current = folder;
	while (current.files.length === 0 && current.folders.size === 1) {
		const only = current.folders.values().next().value;
		if (only === undefined) break;
		current = only;
	}
	return current;
}

function renderFolder(
	folder: Folder,
	depth: number,
	collapsedFolders: ReadonlySet<string>,
	cache: Map<Folder, Totals>,
	out: ChangedTreeNode[],
): void {
	const merged = collapseChain(folder);
	const totals = totalOf(merged, cache);
	out.push({
		kind: "folder",
		path: merged.path,
		depth,
		linesAdded: totals.linesAdded,
		linesRemoved: totals.linesRemoved,
	});
	if (collapsedFolders.has(merged.path)) return;
	for (const child of [...merged.folders.values()].sort(compareFolders)) {
		renderFolder(child, depth + 1, collapsedFolders, cache, out);
	}
	for (const file of [...merged.files].sort(compareFiles)) {
		out.push({ kind: "file", file, depth: depth + 1 });
	}
}

const renderRootFiles = (root: Folder, depth: number, out: ChangedTreeNode[]): void => {
	for (const file of [...root.files].sort(compareFiles)) {
		out.push({ kind: "file", file, depth });
	}
};

/** Flat view returns file nodes at depth 0. Folder view returns folders and files in display order. */
export function buildChangedTree(
	files: ChangedFile[],
	view: "flat" | "folders",
	collapsedFolders: ReadonlySet<string>,
): ChangedTreeNode[] {
	if (view === "flat") {
		return [...files].sort(compareFiles).map((file) => ({ kind: "file", file, depth: 0 }));
	}

	const root = makeFolder("", "");
	for (const file of files) insert(root, file);

	const out: ChangedTreeNode[] = [];
	const cache = new Map<Folder, Totals>();
	for (const folder of [...root.folders.values()].sort(compareFolders)) {
		renderFolder(folder, 0, collapsedFolders, cache, out);
	}
	renderRootFiles(root, 0, out);
	return out;
}
