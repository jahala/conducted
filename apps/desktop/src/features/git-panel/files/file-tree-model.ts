/**
 * @feature REV-06 File tree model
 * Owns: pure functions that turn the flat path list from useFileTree into visible tree rows, given
 * which folders are expanded and the filter text.
 * Behaviour: ui-map.md 3.6, "All files" paragraph ("Filter files").
 * Must handle: folders sorted before files and both alphabetically (Our design choice), a filter
 * that keeps the parents of every match visible and expanded, case-insensitive matching on the whole
 * path, a path list with no folder entries (folders implied by file paths), and 100,000 entries
 * without blocking (the function is linear in the entry count).
 * Test first: entries ["a/b.ts", "a/c.ts", "d.ts"] with "a" collapsed give rows a, d.ts; expanded
 * they give a, a/b.ts, a/c.ts, d.ts.
 */

export interface FileTreeEntry {
	path: string;
	isDirectory: boolean;
}

export interface FileTreeRowModel {
	path: string;
	name: string;
	depth: number;
	isDirectory: boolean;
	expanded: boolean;
}

interface Node {
	path: string;
	name: string;
	isDirectory: boolean;
	children: Map<string, Node>;
}

const makeNode = (path: string, name: string, isDirectory: boolean): Node => ({
	path,
	name,
	isDirectory,
	children: new Map(),
});

const segmentsOf = (path: string): string[] =>
	path
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

/** Adds a path, creating any folder it implies. The node map keeps one entry per path. */
function insert(root: Node, path: string, isDirectory: boolean): void {
	const segments = segmentsOf(path);
	if (segments.length === 0) return;
	let folder = root;
	for (let index = 0; index < segments.length; index++) {
		const name = segments[index];
		if (name === undefined) continue;
		const full = folder.path.length === 0 ? name : `${folder.path}/${name}`;
		const last = index === segments.length - 1;
		let node = folder.children.get(name);
		if (node === undefined) {
			node = makeNode(full, name, last ? isDirectory : true);
			folder.children.set(name, node);
		} else if (last && isDirectory) {
			node.isDirectory = true;
		}
		folder = node;
	}
}

const compareNodes = (left: Node, right: Node): number => {
	const leftFolder = left.isDirectory || left.children.size > 0;
	const rightFolder = right.isDirectory || right.children.size > 0;
	if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
	return left.name.localeCompare(right.name);
};

/** Adds the path and every folder above it, so a deep match keeps its parents on screen. */
function addWithParents(path: string, visible: Set<string>): void {
	const segments = segmentsOf(path);
	let current = "";
	for (const segment of segments) {
		current = current.length === 0 ? segment : `${current}/${segment}`;
		visible.add(current);
	}
}

export function buildFileTreeRows(
	entries: readonly FileTreeEntry[],
	expanded: ReadonlySet<string>,
	filter: string,
): FileTreeRowModel[] {
	const root = makeNode("", "", true);
	for (const entry of entries) insert(root, entry.path, entry.isDirectory);

	const needle = filter.trim().toLowerCase();
	let visible: Set<string> | null = null;
	if (needle.length > 0) {
		visible = new Set();
		for (const entry of entries) {
			if (entry.path.toLowerCase().includes(needle)) addWithParents(entry.path, visible);
		}
	}

	const rows: FileTreeRowModel[] = [];
	const walk = (folder: Node, depth: number): void => {
		const children = [...folder.children.values()].sort(compareNodes);
		for (const child of children) {
			if (visible !== null && !visible.has(child.path)) continue;
			const isDirectory = child.isDirectory || child.children.size > 0;
			const open = visible !== null ? true : expanded.has(child.path);
			rows.push({
				path: child.path,
				name: child.name,
				depth,
				isDirectory,
				expanded: isDirectory && open,
			});
			if (isDirectory && open) walk(child, depth + 1);
		}
	};
	walk(root, 0);
	return rows;
}
