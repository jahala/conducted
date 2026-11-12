/**
 * @feature catalogue A scripted git repository for catalogue workspaces
 * Owns: answering the read-only git commands the app runs in a workspace folder (branch, merge base,
 * changed files with their line counts, untracked files, upstream and sync counts, commits, file
 * patches and file contents) from a small description of the working tree, as git would print them.
 * Behaviour: core/git/commands.ts builds the commands; core/git/status.ts and core/git/diff.ts read the
 * output. The formats here are git's own, so the app's parsers run unchanged.
 * Our design choice: a command this description cannot answer returns null and goes on to the next
 * script; in the end the memory Platform's `shell_unscripted` error, logged by world.ts.
 * Must handle: the `-c core.quotePath=false` prefix the git runner adds; NUL-separated listings.
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import { ok, type Result } from "@conducted/shared";
import type { ShellScript } from "../platform/memory.ts";
import type { ShellCommand, ShellOutput } from "../platform/platform.ts";

export interface ScriptedFile {
	path: string;
	status: "added" | "modified" | "deleted" | "untracked";
	/** The file's text before the change. Empty for an added or untracked file. */
	before: string;
	/** The file's text now. Empty for a deleted file. */
	after: string;
	/** Committed on the branch (true) or only in the working tree (false). */
	committed: boolean;
}

export interface ScriptedCommit {
	sha: string;
	subject: string;
	/** Seconds since the epoch. */
	at: number;
}

export interface ScriptedRepo {
	/** The workspace folder; only commands run there are answered. */
	path: string;
	branch: string;
	/** For example `origin/main`. */
	target: string;
	files: ScriptedFile[];
	/**
	 * Tracked files the branch leaves as they were, by path, with their text. `git show` reads them
	 * at any ref, as git reads a file no commit on the branch touched.
	 */
	unchanged?: Readonly<Record<string, string>>;
	/** Commits on the branch, newest first. */
	commits: ScriptedCommit[];
	/** Null when the branch was never pushed. */
	upstream: { ahead: number; behind: number } | null;
	/** Commits the target has that the branch lacks. */
	behindTarget: number;
	/**
	 * The remote branch was force-pushed after this branch's tip was pushed: the tip is still in the
	 * remote-tracking ref's reflog.
	 */
	remoteRewritten?: boolean;
}

const out = (stdout = "", exitCode = 0, stderr = ""): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** Lines added and removed between two texts, counted the way a simple line diff would. */
function lineCounts(file: ScriptedFile): { added: number; removed: number } {
	const before = lines(file.before);
	const after = lines(file.after);
	const kept = new Set(before.filter((line) => after.includes(line)));
	return {
		added: after.filter((line) => !kept.has(line)).length,
		removed: before.filter((line) => !kept.has(line)).length,
	};
}

/** A unified diff of one file: one hunk covering the whole file. */
function unifiedPatch(file: ScriptedFile): string {
	const before = lines(file.before);
	const after = lines(file.after);
	const oldName =
		file.status === "added" || file.status === "untracked" ? "/dev/null" : `a/${file.path}`;
	const newName = file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
	const body: string[] = [];
	let i = 0;
	let j = 0;
	while (i < before.length || j < after.length) {
		if (i < before.length && j < after.length && before[i] === after[j]) {
			body.push(` ${before[i]}`);
			i++;
			j++;
		} else if (i < before.length && !after.slice(j).includes(before[i] ?? "")) {
			body.push(`-${before[i]}`);
			i++;
		} else {
			body.push(`+${after[j]}`);
			j++;
		}
	}
	const header = [
		`diff --git a/${file.path} b/${file.path}`,
		...(file.status === "added" || file.status === "untracked" ? ["new file mode 100644"] : []),
		...(file.status === "deleted" ? ["deleted file mode 100644"] : []),
		"index 3b18e51..a1f9c02 100644",
		`--- ${oldName}`,
		`+++ ${newName}`,
		`@@ -${before.length === 0 ? 0 : 1},${before.length} +${after.length === 0 ? 0 : 1},${after.length} @@`,
	];
	return `${[...header, ...body].join("\n")}\n`;
}

const STATUS_LETTER = { added: "A", modified: "M", deleted: "D", untracked: "A" } as const;
const MERGE_BASE = "8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d";
const HEAD = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const UPSTREAM = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";

/** The answers for one workspace folder. */
export function scriptRepo(repo: ScriptedRepo): ShellScript {
	const tracked = repo.files.filter((file) => file.status !== "untracked");
	const committed = tracked.filter((file) => file.committed);
	const fileAt = (path: string): ScriptedFile | undefined =>
		repo.files.find((file) => file.path === path);
	const nameStatus = (files: ScriptedFile[]): string =>
		files.map((file) => `${STATUS_LETTER[file.status]}\t${file.path}\n`).join("");
	const numstat = (files: ScriptedFile[]): string =>
		files
			.map((file) => {
				const counts = lineCounts(file);
				return `${counts.added}\t${counts.removed}\t${file.path}\n`;
			})
			.join("");

	// An upstream with nothing to push or pull points at the same commit as HEAD.
	const inSync = repo.upstream !== null && repo.upstream.ahead === 0 && repo.upstream.behind === 0;
	const upstreamSha = inSync ? HEAD : UPSTREAM;

	return (command: ShellCommand) => {
		if (command.cwd !== repo.path) return null;
		if (command.program === "stat") {
			// `stat -f %z -- <path>`: the size of a file, or exit 1 when it does not exist.
			const target = command.args.at(-1) ?? "";
			const relative = target.startsWith(`${repo.path}/`)
				? target.slice(repo.path.length + 1)
				: target;
			const file = fileAt(relative);
			if (file === undefined)
				return out("", 1, `stat: ${target}: stat: No such file or directory\n`);
			return out(`${new TextEncoder().encode(file.after).length}\n`);
		}
		if (command.program !== "git") return null;
		const args = command.args[0] === "-c" ? command.args.slice(2) : [...command.args];
		const joined = args.join(" ");
		const [verb] = args;
		const literalPath = (): string | null => {
			const spec = args.find((arg) => arg.startsWith(":(literal)"));
			return spec === undefined ? null : spec.slice(":(literal)".length);
		};

		if (joined === "branch --show-current") return out(`${repo.branch}\n`);
		// An empty branch is a detached HEAD: no symbolic ref to read.
		if (joined === "symbolic-ref HEAD") {
			return repo.branch === ""
				? out("", 128, "fatal: ref HEAD is not a symbolic ref\n")
				: out(`refs/heads/${repo.branch}\n`);
		}
		if (joined === "rev-parse HEAD") return out(`${HEAD}\n`);
		if (verb === "merge-base" && args[1] === "--is-ancestor") return out("", 1);
		if (verb === "merge-base") return out(`${MERGE_BASE}\n`);
		if (joined === "rev-parse --git-common-dir") return out(`${repo.path}/.git\n`);
		if (verb === "rev-parse" && args[1] === "--git-path") {
			return out(`${repo.path}/.git/${args[2] ?? ""}\n`);
		}
		if (verb === "rev-parse" && args.includes("@{u}")) {
			if (repo.upstream === null) return out("", 128, "fatal: no upstream configured\n");
			if (args.includes("--abbrev-ref")) return out(`origin/${repo.branch}\n`);
			if (args.includes("--symbolic-full-name")) return out(`refs/remotes/origin/${repo.branch}\n`);
			return out(`${HEAD}\n${upstreamSha}\n`);
		}
		if (verb === "rev-parse" && args[1] === "--verify") {
			const pushed = repo.upstream !== null && args.at(-1) === `refs/remotes/origin/${repo.branch}`;
			return pushed ? out(`${upstreamSha}\n`) : out("", 1);
		}
		if (verb === "show-ref") return out("", 1);
		if (verb === "reflog") {
			return out(repo.remoteRewritten === true ? `${upstreamSha}\n${HEAD}\n` : `${upstreamSha}\n`);
		}
		if (verb === "rev-list" && args[1] === "--left-right") {
			// `<a>...<b>` prints the commits only in a, a tab, then the commits only in b.
			const [left = "", right = ""] = (args[3] ?? "").split("...");
			const isSha = (ref: string): boolean => ref === HEAD || ref === UPSTREAM;
			if (isSha(left) && isSha(right)) {
				const ahead = repo.upstream?.ahead ?? 0;
				const behind = repo.upstream?.behind ?? 0;
				return out(
					left === HEAD && right !== HEAD ? `${ahead}\t${behind}\n` : `${behind}\t${ahead}\n`,
				);
			}
			const branchFirst = left === repo.branch || left === "HEAD";
			return out(
				branchFirst
					? `${repo.commits.length}\t${repo.behindTarget}\n`
					: `${repo.behindTarget}\t${repo.commits.length}\n`,
			);
		}
		if (verb === "rev-list" && args[1] === "--count") {
			const range = args[2] ?? "";
			return out(`${range.startsWith(repo.target) ? repo.commits.length : repo.behindTarget}\n`);
		}
		if (verb === "log") {
			return out(
				repo.commits
					.map((commit) =>
						[commit.sha, commit.subject, "Sam Rivera", "sam@example.com", commit.at].join("\x1f"),
					)
					.join("\n"),
			);
		}
		if (verb === "status") {
			const dirty = tracked.filter((file) => !file.committed);
			const untracked = repo.files.filter((file) => file.status === "untracked");
			const all = args.includes("--untracked-files=all");
			return out(
				[
					...dirty.map((file) => ` ${STATUS_LETTER[file.status]} ${file.path}\n`),
					...(all ? untracked.map((file) => `?? ${file.path}\n`) : []),
				].join(""),
			);
		}
		if (verb === "ls-files" && args.includes("--others") && !args.includes("--ignored")) {
			return out(
				repo.files
					.filter((file) => file.status === "untracked")
					.map((file) => `${file.path}\0`)
					.join(""),
			);
		}
		if (verb === "ls-files" && args.includes("--ignored")) return out("node_modules/\0dist/\0");
		if (verb === "ls-files" && args.length === 1)
			return out(repo.files.map((file) => `${file.path}\n`).join(""));
		if (verb === "ls-files") return out("");
		if (verb === "diff" && args.includes("--no-index")) {
			const path = args.at(-1) ?? "";
			const file = fileAt(path.startsWith(repo.path) ? path.slice(repo.path.length + 1) : path);
			if (file === undefined) return out("", 0);
			if (args.includes("--numstat")) {
				return out(`${lineCounts(file).added}\t0\t${file.path}\n`, 1);
			}
			return out(unifiedPatch(file), 1);
		}
		if (verb === "diff" && args.includes("--diff-filter=U")) return out("");
		if (verb === "diff" && args.includes("--name-only")) {
			return out(tracked.map((file) => `${file.path}\0`).join(""));
		}
		if (verb === "diff") {
			const toHead = args.includes("HEAD");
			const scope = toHead ? committed : tracked;
			const path = literalPath();
			if (path !== null) {
				const file = fileAt(path);
				if (file === undefined) return out("");
				if (args.includes("--numstat")) return out(numstat([file]));
				return out(unifiedPatch(file));
			}
			if (args.includes("--name-status")) return out(nameStatus(scope));
			if (args.includes("--numstat")) return out(numstat(scope));
			return null;
		}
		if (verb === "show" && args.some((arg) => arg.includes(":"))) {
			const spec = args.find((arg) => arg.includes(":")) ?? "";
			const path = spec.slice(spec.indexOf(":") + 1);
			const file = fileAt(path);
			const kept = file === undefined ? repo.unchanged?.[path] : undefined;
			if (kept !== undefined) return out(kept);
			if (file === undefined || file.before === "")
				return out("", 128, `fatal: path '${path}' does not exist\n`);
			return out(file.before);
		}
		// The rename the first message's branch name asks for (GIT-13).
		if (verb === "branch" && args[1] === "-m") return out("");
		if (verb === "branch" && args[1]?.startsWith("--format")) {
			return out(`${repo.branch}\nmain\n`);
		}
		// Only the remote's branches exist; a checkpoint prune listing its own refs finds none.
		if (verb === "for-each-ref" && args.some((arg) => arg.startsWith("refs/remotes/"))) {
			return out("origin/main\norigin/release\n");
		}
		if (verb === "for-each-ref") return out("");
		if (verb === "config" && args[1] === "--get" && repo.upstream !== null) {
			if (args[2] === `branch.${repo.branch}.remote`) return out("origin\n");
			if (args[2] === `branch.${repo.branch}.merge`) return out(`refs/heads/${repo.branch}\n`);
		}
		if (verb === "config") return out("", 1);
		if (verb === "remote" && args[1] === "get-url") return out("git@github.com:acme/atlas.git\n");
		if (verb === "merge-tree") return out(`${HEAD}\n`);
		return null;
	};
}
