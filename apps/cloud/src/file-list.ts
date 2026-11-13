/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the recursive listing of a sandbox folder that a local mirror is built from.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A10 (file_sync pulls changes from
 * the remote workspace into a local mirror) and services-map.md 5A.5.5 (the mirror holds the
 * workspace's files).
 * Must handle: folders, files and symlinks; a symlink is listed but never followed, so the walk
 * cannot leave the workspace; a `.git` folder is skipped because the mirror's path guard refuses
 * it; an entry that vanishes between listing and stat is left out; a folder with more entries than
 * the cap stops the walk with `truncated`, so one giant tree cannot exhaust the Worker.
 * Our design choice: the walk is breadth-first and the cap counts entries, not folders. The
 * desktop polls this list and fetches each file, so a bound here bounds one sync.
 * Test first: lists nested files, skips .git and does not follow a symlink.
 */
import { trimTrailingSlashes } from "@conducted/shared";

/** Most entries one list may return. A bigger tree is reported as truncated. */
export const FILE_LIST_LIMIT = 20_000;

/** The stat fields the walk reads from the Sandbox SDK's file stat. */
export interface ListedStat {
	type: string;
	size: number | bigint;
	modifiedAt: Date;
}

/** The two sandbox file operations the walk uses. */
export interface ListingFiles {
	readDirectory(path: string): Promise<{ name: string }[]>;
	stat(path: string): Promise<ListedStat>;
}

/** One entry of the recursive listing, in the desktop's Platform FileStat shape. */
export interface ListedFile {
	path: string;
	isDirectory: boolean;
	isSymlink: boolean;
	size: number;
	modifiedAt: number;
}

export interface FileTree {
	entries: ListedFile[];
	/** True when the walk stopped at the cap, so the list is not the whole tree. */
	truncated: boolean;
}

/** Joins a folder and a child name without a doubled slash. */
const childOf = (folder: string, name: string): string =>
	`${folder === "/" ? "" : trimTrailingSlashes(folder)}/${name}`;

/**
 * Lists every descendant of `root` except `.git` and the contents of symlinks. The root itself
 * is not an entry. A folder that cannot be read is left out rather than failing the whole walk.
 */
export async function walkFileTree(
	root: string,
	files: ListingFiles,
	limit: number = FILE_LIST_LIMIT,
): Promise<FileTree> {
	const entries: ListedFile[] = [];
	const pending: string[] = [root];
	while (pending.length > 0) {
		if (entries.length >= limit) return { entries, truncated: true };
		const folder = pending.shift();
		if (folder === undefined) break;
		let children: { name: string }[];
		try {
			children = await files.readDirectory(folder);
		} catch {
			continue;
		}
		for (const child of children) {
			if (entries.length >= limit) return { entries, truncated: true };
			if (child.name === ".git") continue;
			const path = childOf(folder, child.name);
			let stat: ListedStat;
			try {
				stat = await files.stat(path);
			} catch {
				continue;
			}
			const isDirectory = stat.type === "directory";
			const isSymlink = stat.type === "symlink";
			entries.push({
				path,
				isDirectory,
				isSymlink,
				size: Number(stat.size),
				modifiedAt: stat.modifiedAt.getTime(),
			});
			if (isDirectory && !isSymlink) pending.push(path);
		}
	}
	return { entries, truncated: false };
}
