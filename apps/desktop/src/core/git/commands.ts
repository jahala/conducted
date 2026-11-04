/**
 * @feature GIT-01 Catalogue of every git invocation the app makes
 * Owns: one pure function per git (or helper script) invocation, each returning a `GitCommand`
 * value. Nothing here runs a process. The runner (runner.ts) executes the value.
 * Behaviour: services-map.md part 3 (3.1 create, 3.3 polling, 3.4 diffs, 3.6 push and pull,
 * 3.10 archive, 3.11 rename and retarget, 3.12 checkpoints, 3.13 worktree config, 3.15 minimal set).
 * Must handle: arguments are an array and are never joined into a shell string; user-controlled
 * names (branches, paths) are always separate array items, so they cannot inject options;
 * paths passed to `diff` use the `:(literal)` pathspec; exit codes that carry meaning (1 from
 * `--verify --quiet`, 1 from `--no-index`) are listed in `okExitCodes`.
 * Our design choice: the app never runs `commit`, `rebase`, `merge` (except fast-forward) or
 * conflict repair itself. The agent does that on request (see services/agent-instructions.ts).
 * The only `reset --hard` is `resetHard` for the retarget case in services-map 3.11.
 * Test first: revParseVerify("refs/heads/x") lists exit codes 0 and 1 as success.
 */

export interface GitCommand {
	/** "git", "gh", "gt", or an absolute path to a helper script such as checkpointer.sh. */
	readonly program: string;
	readonly args: readonly string[];
	/** Exit codes that mean "the command did what we asked". Default: only 0. */
	readonly okExitCodes?: readonly number[];
	readonly timeoutMs?: number;
	/** Retry on git's own lock errors (index.lock, ref lock). Default true for program "git". */
	readonly retryOnLock?: boolean;
	/** Needs the network. The runner may retry over HTTPS when SSH is blocked. */
	readonly network?: boolean;
	readonly stdin?: string;
}

const git = (
	args: readonly string[],
	extra: Partial<Omit<GitCommand, "program" | "args">> = {},
): GitCommand => ({
	program: "git",
	args,
	...extra,
});

/** Exit codes for `--verify --quiet` style probes: 0 found, 1 missing. */
const PROBE = [0, 1] as const;

// ---------------------------------------------------------------- reading refs and config

export const revParse = (rev: string): GitCommand => git(["rev-parse", rev]);
export const revParseHead = (): GitCommand => git(["rev-parse", "HEAD"]);
export const revParseVerify = (ref: string): GitCommand =>
	git(["rev-parse", "--verify", "--quiet", ref], { okExitCodes: PROBE });
export const revParseGitCommonDir = (): GitCommand => git(["rev-parse", "--git-common-dir"]);
export const revParseGitPath = (name: string): GitCommand => git(["rev-parse", "--git-path", name]);
export const showRefVerify = (ref: string): GitCommand =>
	git(["show-ref", "--verify", "--quiet", ref], { okExitCodes: PROBE });
export const branchShowCurrent = (): GitCommand => git(["branch", "--show-current"]);
export const configGet = (key: string): GitCommand =>
	git(["config", "--get", key], { okExitCodes: PROBE });
export const configGetLocal = (key: string): GitCommand =>
	git(["config", "--local", "--get", key], { okExitCodes: PROBE });
export const configGetWorktree = (key: string): GitCommand =>
	git(["config", "--worktree", "--get", key], { okExitCodes: PROBE });
export const configSet = (key: string, value: string): GitCommand => git(["config", key, value]);
export const configSetWorktree = (key: string, value: string): GitCommand =>
	git(["config", "--worktree", key, value]);
export const remoteGetUrl = (remote: string): GitCommand => git(["remote", "get-url", remote]);
export const remoteSetUrl = (remote: string, url: string): GitCommand =>
	git(["remote", "set-url", remote, url]);
export const symbolicRefRemoteHead = (remote: string): GitCommand =>
	git(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { okExitCodes: [0, 128] });
export const catFileCommit = (ref: string): GitCommand => git(["cat-file", "commit", ref]);
export const catFileExists = (object: string): GitCommand =>
	git(["cat-file", "-e", object], { okExitCodes: PROBE });

// ---------------------------------------------------------------- repository and worktrees

export const commitEmptyInitial = (): GitCommand =>
	git(["commit", "--allow-empty", "-m", "Initial commit"]);
export const initRepository = (): GitCommand => git(["init"]);
export const cloneWithProgress = (url: string, destination: string): GitCommand =>
	git(["clone", "--progress", "--", url, destination], { network: true, retryOnLock: false });

/** Fetch without touching FETCH_HEAD, so concurrent fetches do not fight (services-map 3.6.5). */
export const fetch = (remote: string, refspecs: readonly string[] = []): GitCommand =>
	git(["fetch", "--no-write-fetch-head", "--prune", remote, ...refspecs], { network: true });

export const worktreeAddNewBranch = (path: string, branch: string, startSha: string): GitCommand =>
	git(["worktree", "add", path, "-b", branch, startSha], { retryOnLock: false });
export const worktreeAddExistingBranch = (path: string, branch: string): GitCommand =>
	git(["worktree", "add", path, branch], { retryOnLock: false });
export const worktreeList = (): GitCommand => git(["worktree", "list", "--porcelain"]);
export const worktreeRemove = (path: string): GitCommand =>
	git(["worktree", "remove", "--force", "--force", path]);
export const worktreePrune = (): GitCommand => git(["worktree", "prune"]);

export const enableWorktreeConfig = (): GitCommand =>
	configSet("extensions.worktreeConfig", "true");
export const enablePushAutoSetupRemote = (): GitCommand =>
	configSetWorktree("push.autoSetupRemote", "true");

export const lsFiles = (): GitCommand => git(["ls-files"]);
export const lsFilesUntracked = (): GitCommand =>
	git(["ls-files", "--others", "--exclude-standard"]);
export const lsFilesUnmerged = (): GitCommand => git(["ls-files", "-u"]);

// ---------------------------------------------------------------- branches

export const branchCreate = (name: string, startPoint: string): GitCommand =>
	git(["branch", name, startPoint]);
export const branchRename = (oldName: string | null, newName: string): GitCommand =>
	git(oldName === null ? ["branch", "-m", newName] : ["branch", "-m", oldName, newName]);
export const branchDeleteForce = (name: string): GitCommand => git(["branch", "-D", name]);
export const branchListLocal = (): GitCommand =>
	git(["branch", "--format=%(refname:short)", "--sort=-committerdate"]);
export const forEachRefRemoteBranches = (remote: string): GitCommand =>
	git([
		"for-each-ref",
		"--sort=-committerdate",
		"--format=%(refname:short)",
		`refs/remotes/${remote}`,
	]);
export const checkout = (branch: string): GitCommand => git(["checkout", branch]);
export const checkoutNewBranch = (branch: string, startSha: string): GitCommand =>
	git(["checkout", "-b", branch, startSha]);
/** Lists the full names of refs under a prefix, one per line. */
export const forEachRefNames = (prefix: string): GitCommand =>
	git(["for-each-ref", "--format=%(refname)", prefix]);
export const updateRef = (ref: string, sha: string): GitCommand => git(["update-ref", ref, sha]);
export const updateRefDelete = (ref: string): GitCommand => git(["update-ref", "-d", ref]);

// ---------------------------------------------------------------- status and changes (3.3)

export const mergeBase = (a: string, b: string): GitCommand => git(["merge-base", a, b]);
export const isAncestor = (ancestor: string, descendant: string): GitCommand =>
	git(["merge-base", "--is-ancestor", ancestor, descendant], { okExitCodes: PROBE });

const DIFF_BASE = ["diff", "-M", "--no-ext-diff", "--no-textconv"] as const;

/** `to` null compares against the working tree. */
export const diffNameStatus = (from: string, to: string | null = null): GitCommand =>
	git([...DIFF_BASE, "--name-status", from, ...(to === null ? [] : [to])]);
export const diffNumstat = (from: string, to: string | null = null): GitCommand =>
	git([...DIFF_BASE, "--numstat", from, ...(to === null ? [] : [to])]);
export const diffNameOnlyNul = (from: string, to: string | null = null): GitCommand =>
	git([...DIFF_BASE, "--name-only", "-z", from, ...(to === null ? [] : [to])]);
/** Only used to find conflicted paths; untracked files are listed separately. */
export const statusPorcelain = (): GitCommand =>
	git(["status", "--porcelain", "--untracked-files=no"]);
/** Counts added lines of one untracked file. Exit 1 is normal for `--no-index` with changes. */
export const diffNoIndexNumstat = (path: string): GitCommand =>
	git(["diff", "--no-index", "--numstat", "--", "/dev/null", path], { okExitCodes: PROBE });
export const revParseHeadAndUpstream = (): GitCommand =>
	git(["rev-parse", "HEAD", "@{u}"], { okExitCodes: [0, 128] });
export const upstreamName = (): GitCommand =>
	git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { okExitCodes: [0, 128] });
/** Output "<left>\t<right>": commits only in `a`, commits only in `b`. */
export const revListLeftRightCount = (a: string, b: string): GitCommand =>
	git(["rev-list", "--left-right", "--count", `${a}...${b}`]);
export const revListCount = (range: string): GitCommand => git(["rev-list", "--count", range]);
export const logRange = (range: string): GitCommand =>
	git(["log", range, "--format=%H|%s|%an|%ae|%at"]);

// ---------------------------------------------------------------- diffs (3.4)

export const showFileAt = (ref: string, path: string): GitCommand =>
	git(["show", "--no-ext-diff", "--no-textconv", `${ref}:${path}`], { okExitCodes: [0, 128] });
export const diffFilePatch = (
	from: string,
	to: string | null,
	path: string,
	ignoreWhitespace: boolean,
): GitCommand =>
	git([
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		...(ignoreWhitespace ? ["--ignore-all-space"] : []),
		from,
		...(to === null ? [] : [to]),
		"--",
		`:(literal)${path}`,
	]);
export const diffUntrackedFilePatch = (path: string, ignoreWhitespace: boolean): GitCommand =>
	git(
		[
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-color",
			...(ignoreWhitespace ? ["--ignore-all-space"] : []),
			"--no-index",
			"--",
			"/dev/null",
			path,
		],
		{ okExitCodes: PROBE },
	);
export const diffNumstatForFile = (from: string, to: string | null, path: string): GitCommand =>
	git([
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--numstat",
		from,
		...(to === null ? [] : [to]),
		"--",
		`:(literal)${path}`,
	]);
export const showCommitNameStatus = (hash: string): GitCommand =>
	git(["show", "--no-ext-diff", "--no-textconv", hash, "--format=", "--name-status"]);
export const showCommitNumstat = (hash: string): GitCommand =>
	git(["show", "--no-ext-diff", "--no-textconv", hash, "--format=", "--numstat"]);
/** The agent-facing diff, taken between the merge base and a saved checkpoint ref. */
export const diffAgainstRef = (
	base: string,
	ref: string,
	statOnly: boolean,
	path?: string,
): GitCommand =>
	git([
		"diff",
		...(statOnly ? ["--stat"] : []),
		base,
		ref,
		...(path === undefined ? [] : ["--", path]),
	]);

// ---------------------------------------------------------------- push and pull (3.6)

export const pushHeadTo = (remote: string, remoteBranch: string): GitCommand =>
	git(["push", remote, `HEAD:${remoteBranch}`], { network: true });
export const pushHeadSetUpstream = (remote: string, remoteBranch: string): GitCommand =>
	git(["push", "-u", remote, `HEAD:${remoteBranch}`], { network: true });
export const pushPlain = (): GitCommand => git(["push"], { network: true });
export const pull = (): GitCommand => git(["pull"], { network: true });
export const mergeFastForwardOnly = (ref: string): GitCommand => git(["merge", "--ff-only", ref]);
export const fetchBranchRefspec = (remote: string, branch: string): GitCommand =>
	fetch(remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);

/**
 * The commands of a first push, in order: push with upstream, then write the two branch config
 * keys, then fetch the branch so the remote-tracking ref exists (services-map 3.6.1).
 * The caller runs them under the worktree lock and the repo lock.
 */
export const firstPushSteps = (
	remote: string,
	localBranch: string,
	remoteBranch: string,
): readonly GitCommand[] => [
	pushHeadSetUpstream(remote, remoteBranch),
	configSet(`branch.${localBranch}.remote`, remote),
	configSet(`branch.${localBranch}.merge`, `refs/heads/${remoteBranch}`),
	fetchBranchRefspec(remote, remoteBranch),
];

// ---------------------------------------------------------------- restoring files (3.11)

export const resetHard = (ref: string): GitCommand => git(["reset", "--hard", ref]);
export const restoreFromSource = (source: string, path: string): GitCommand =>
	git(["restore", `--source=${source}`, "--worktree", "--staged", "--", path]);
export const restoreStaged = (path: string): GitCommand => git(["restore", "--staged", "--", path]);
export const removeCached = (path: string): GitCommand =>
	git(["rm", "--cached", "--force", "--", path]);

// ---------------------------------------------------------------- git identity and settings

export const configUserName = (): GitCommand => configGet("user.name");
export const configUserEmail = (): GitCommand => configGet("user.email");
export const configPullRebase = (): GitCommand => configGet("pull.rebase");

// ---------------------------------------------------------------- helper scripts (bin/)

/** Runs bin/checkpointer.sh. Exit codes 101 and 102 mean "skipped" (see refs.ts). */
export const checkpointerSave = (script: string, id: string): GitCommand => ({
	program: script,
	args: ["save", "--id", id, "--force"],
	okExitCodes: [0, 101, 102],
	timeoutMs: 60_000,
	retryOnLock: false,
});
export const checkpointerRestore = (script: string, id: string): GitCommand => ({
	program: script,
	args: ["restore", id],
	retryOnLock: false,
});
export const checkpointerDiff = (
	script: string,
	fromId: string,
	to: string,
	gitDiffArgs: readonly string[],
): GitCommand => ({
	program: script,
	args: ["diff", fromId, to, "--", ...gitDiffArgs],
	retryOnLock: false,
});
