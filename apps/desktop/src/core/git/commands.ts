/**
 * @feature GIT-01 Catalogue of every git invocation the app makes
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: one pure function per git (or helper script) invocation, each returning a `GitCommand`
 * value. Nothing here runs a process. The runner (runner.ts) executes the value.
 * Behaviour: services-map.md part 3 (3.1 create, 3.3 polling, 3.4 diffs, 3.6 push and pull,
 * 3.10 archive, 3.11 rename, retarget, sparse checkout and external diff, 3.12 checkpoints,
 * 3.13 worktree config, 3.15 minimal set).
 * Must handle: arguments are an array and are never joined into a shell string, so a name cannot
 * add shell syntax; remote and branch names for fetch, push, remote and branch commands come after
 * `--`, so a name that looks like an option is read as a name; revision arguments (checkout,
 * rev-parse, diff, log) have no such guard, because those commands read `--` as "paths follow":
 * callers pass refs git itself listed, and git refuses to create a ref that starts with `-`;
 * paths passed to `diff` use the `:(literal)` pathspec; exit codes that carry meaning (1 from
 * `--verify --quiet`, 1 from `--no-index`) are listed in `okExitCodes`.
 * Our design choice: the app never runs `commit`, `rebase`, `merge` (except fast-forward) or
 * conflict repair itself, except the first commit of a folder Quick start creates or turns into a
 * GitHub repository (PRJ-03, services-map 3.2). The agent does every later commit on request (see
 * services/agent-instructions.ts). The only `reset --hard` is `resetHard` for the retarget case in
 * services-map 3.11.
 * Test first: revParseVerify("refs/heads/x") lists exit codes 0 and 1 as success.
 * CLOUD-04 test first: reads a cloud repo's shared clone: set-head, one branch fetch and ls-tree.
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
export const remoteGetUrl = (remote: string): GitCommand =>
	git(["remote", "get-url", "--", remote]);
/** Points a shared clone's `<remote>/HEAD` at the remote's default branch (services-map 3.14). */
export const remoteSetHead = (remote: string): GitCommand =>
	git(["remote", "set-head", remote, "--auto"]);
export const remoteSetUrl = (remote: string, url: string): GitCommand =>
	git(["remote", "set-url", "--", remote, url]);
export const remoteRename = (oldName: string, newName: string): GitCommand =>
	git(["remote", "rename", oldName, newName]);
export const remoteRemove = (name: string): GitCommand => git(["remote", "remove", name]);
export const symbolicRefRemoteHead = (remote: string): GitCommand =>
	git(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { okExitCodes: [0, 128] });
export const catFileCommit = (ref: string): GitCommand => git(["cat-file", "commit", ref]);
export const catFileExists = (object: string): GitCommand =>
	git(["cat-file", "-e", object], { okExitCodes: PROBE });

// ---------------------------------------------------------------- repository and worktrees

export const commitEmptyInitial = (): GitCommand =>
	git(["commit", "--allow-empty", "-m", "Initial commit"]);
export const commitAll = (message: string): GitCommand => git(["commit", "-m", message]);
export const addAll = (): GitCommand => git(["add", "-A"]);
/** Stages one path, and nothing else. */
export const addPath = (path: string): GitCommand => git(["add", "--", path]);
export const initRepository = (): GitCommand => git(["init"]);
export const cloneWithProgress = (url: string, destination: string): GitCommand =>
	git(["clone", "--progress", "--", url, destination], { network: true, retryOnLock: false });

/** Fetch without touching FETCH_HEAD, so concurrent fetches do not fight (services-map 3.6.5). */
export const fetch = (remote: string, refspecs: readonly string[] = []): GitCommand =>
	git(["fetch", "--no-write-fetch-head", "--prune", "--", remote, ...refspecs], { network: true });

/**
 * One branch into its remote-tracking ref in a shared clone, without touching FETCH_HEAD or other
 * refs (services-map 3.14).
 */
export const fetchBranchIntoRemoteRef = (remote: string, branch: string): GitCommand =>
	git(
		[
			"fetch",
			"--no-write-fetch-head",
			"--",
			remote,
			`refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
		],
		{ network: true },
	);

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
/** NUL separated, so git never quotes a path (services-map 3.0.5). */
export const lsFilesUntracked = (): GitCommand =>
	git(["ls-files", "--others", "--exclude-standard", "-z"]);
export const lsFilesUnmerged = (): GitCommand => git(["ls-files", "-u"]);

// ---------------------------------------------------------------- branches

export const branchCreate = (name: string, startPoint: string): GitCommand =>
	git(["branch", "--", name, startPoint]);
export const branchRename = (oldName: string | null, newName: string): GitCommand =>
	git(
		oldName === null ? ["branch", "-m", "--", newName] : ["branch", "-m", "--", oldName, newName],
	);
export const branchDeleteForce = (name: string): GitCommand => git(["branch", "-D", "--", name]);
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
/** Diff scope "Current branch": committed changes from the merge base to HEAD (ui-map 3.6). */
export const currentBranchDiffNameStatus = (mergeBase: string): GitCommand =>
	diffNameStatus(mergeBase, "HEAD");
export const currentBranchDiffNumstat = (mergeBase: string): GitCommand =>
	diffNumstat(mergeBase, "HEAD");
/** Diff scope "All changes": branch commits plus uncommitted changes (merge base to worktree). */
export const allChangesDiffNameStatus = (mergeBase: string): GitCommand =>
	diffNameStatus(mergeBase);
export const allChangesDiffNumstat = (mergeBase: string): GitCommand => diffNumstat(mergeBase);
export const diffNameOnlyNul = (from: string, to: string | null = null): GitCommand =>
	git([...DIFF_BASE, "--name-only", "-z", from, ...(to === null ? [] : [to])]);
/** Paths with unresolved merge conflicts, NUL separated (services-map 3.10 discard step). */
export const diffUnmergedPathsNul = (): GitCommand =>
	git(["diff", "--name-only", "--diff-filter=U", "-z"]);
/** Marks conflicted paths as resolved without staging their content (services-map 3.10). */
export const addUpdatedPaths = (paths: readonly string[]): GitCommand =>
	git(["add", "-u", "--", ...paths]);
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
	git(["log", range, "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%at"]);

// ---------------------------------------------------------------- local-git forge (3.7.7)

/**
 * Predicts whether merging `branch` into `target` would conflict, without touching any worktree.
 * Exit 1 means conflicts, which is an answer and not a failure. Any conflict stage line in the
 * output (`<mode> <oid> <1|2|3>\t<path>`) also means conflicts.
 */
export const mergeTreeWriteTree = (target: string, branch: string): GitCommand =>
	git(["merge-tree", "--write-tree", "--no-messages", target, branch], { okExitCodes: PROBE });

// ---------------------------------------------------------------- catching up a stack branch (3.8.3)

/** The branch HEAD names. Exit 128 means a detached HEAD. */
export const symbolicRefHead = (): GitCommand =>
	git(["symbolic-ref", "HEAD"], { okExitCodes: [0, 128] });
/** The full ref name of the upstream, for example `refs/remotes/origin/main`. */
export const upstreamFullName = (): GitCommand =>
	git(["rev-parse", "--symbolic-full-name", "@{u}"], { okExitCodes: [0, 128] });
/** Hashes the text given on stdin, to make an identity out of a remote URL. */
export const hashObjectStdin = (text: string): GitCommand =>
	git(["hash-object", "--stdin"], { stdin: text });
/**
 * Applies `verify` and `update` lines in one transaction, which makes a compare-and-swap on a ref.
 * Each instruction is one line, for example `update <ref> <new> <old>`.
 */
export const updateRefStdin = (instructions: readonly string[]): GitCommand =>
	git(["update-ref", "--stdin"], { stdin: `${instructions.join("\n")}\n` });
/** Every commit the ref has pointed to, newest first. */
export const reflogHashes = (ref: string): GitCommand =>
	git(["reflog", "show", "--format=%H", ref]);
/** Empty output means a clean tree, with untracked files counted. */
export const statusPorcelainAll = (): GitCommand =>
	git(["status", "--porcelain=v1", "--untracked-files=all"]);
/** Ignored paths, collapsed to their top folder, NUL separated. */
export const lsFilesIgnoredNul = (): GitCommand =>
	git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
/** Paths that `to` adds compared with `from`, NUL separated. */
export const diffTreeAddedNul = (from: string, to: string): GitCommand =>
	git([
		"diff-tree",
		"--no-commit-id",
		"--name-only",
		"--no-renames",
		"--diff-filter=A",
		"-r",
		"-z",
		from,
		to,
	]);
/**
 * Replays the local commits onto the upstream tip. The caller passes `GIT_SEQUENCE_EDITOR` in the
 * run options: a script that checks the rebase still starts from the state it was planned on.
 */
export const rebaseOntoUpstream = (upstreamOid: string, localOid: string): GitCommand =>
	git(
		[
			"rebase",
			"--interactive",
			"--no-autostash",
			"--no-update-refs",
			"--no-autosquash",
			"--no-rebase-merges",
			"--no-fork-point",
			"--onto",
			upstreamOid,
			localOid,
		],
		{ retryOnLock: false },
	);

// ---------------------------------------------------------------- diffs (3.4)

export const showFileAt = (ref: string, path: string): GitCommand =>
	git(["show", "--no-ext-diff", "--no-textconv", `${ref}:${path}`], { okExitCodes: [0, 128] });
/** The committed settings of a repository, read from a ref instead of the checkout (DATA-05). */
export const showSettingsFileAt = (ref: string): GitCommand =>
	showFileAt(ref, ".conducted/settings.toml");
/** True when a shared clone's ref has a path (services-map 3.14). */
export const lsTreeFileAt = (ref: string, path: string): GitCommand =>
	git(["ls-tree", ref, "--", path]);
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

/** The branch's changes against the merge base, including uncommitted work (services-map 3.4.6). */
export const diffWorkingTree = (base: string, statOnly: boolean, path?: string): GitCommand =>
	git([
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		...(statOnly ? ["--stat"] : []),
		base,
		...(path === undefined ? [] : ["--", `:(literal)${path}`]),
	]);

// ---------------------------------------------------------------- push and pull (3.6)

export const pushHeadTo = (remote: string, remoteBranch: string): GitCommand =>
	git(["push", "--", remote, `HEAD:${remoteBranch}`], { network: true });
export const pushHeadSetUpstream = (remote: string, remoteBranch: string): GitCommand =>
	git(["push", "-u", "--", remote, `HEAD:${remoteBranch}`], { network: true });
/**
 * The first push of a repository just made with `gh repo create`, with gh as the credential helper
 * for github.com, so it works without a helper of the user's own (services-map 3.2).
 */
export const pushSetUpstreamHeadWithGh = (remote: string): GitCommand =>
	git(
		[
			"-c",
			"credential.https://github.com.helper=!gh auth git-credential",
			"push",
			"-u",
			remote,
			"HEAD",
		],
		{ network: true },
	);
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

// ---------------------------------------------------------------- git extras (3.11)

/**
 * `git diff --quiet HEAD` exits 1 when the file has changes. The path is a literal pathspec, so
 * a name git could read as an option stays a name.
 */
export const diffQuietHead = (path?: string): GitCommand =>
	git(["diff", "--quiet", "HEAD", ...(path === undefined ? [] : ["--", `:(literal)${path}`])], {
		okExitCodes: PROBE,
	});

/**
 * Lists the path when git does not track it yet (a new file), and prints nothing otherwise. NUL
 * separated, with a literal pathspec, like `diffQuietHead`.
 */
export const lsFilesUntrackedPath = (path: string): GitCommand =>
	git(["ls-files", "--others", "--exclude-standard", "-z", "--", `:(literal)${path}`]);

/** The Kaleidoscope diff command Conductor configures for `git difftool` (services-map 3.11). */
const KSDIFF_DIFF_COMMAND =
	'ksdiff --partial-changeset --relative-path "$MERGED" -- "$LOCAL" "$REMOTE"';

/** Opens the file's changes, or the whole working tree, in Kaleidoscope. */
export const diffToolKsdiff = (path?: string): GitCommand =>
	git(
		[
			"-c",
			`difftool.ksdiff.cmd=${KSDIFF_DIFF_COMMAND}`,
			"difftool",
			"--tool=ksdiff",
			"--no-prompt",
			"HEAD",
			...(path === undefined ? [] : ["--", `:(literal)${path}`]),
		],
		{ retryOnLock: false },
	);

export const sparseCheckoutConfig = (): GitCommand => configGet("core.sparseCheckout");
export const sparseCheckoutInitCone = (): GitCommand => git(["sparse-checkout", "init", "--cone"]);
export const sparseCheckoutList = (): GitCommand => git(["sparse-checkout", "list"]);
export const sparseCheckoutSet = (directories: readonly string[]): GitCommand =>
	git(["sparse-checkout", "set", "--", ...directories]);
export const sparseCheckoutDisable = (): GitCommand => git(["sparse-checkout", "disable"]);
/** The top-level folders of the checked-out commit, the choices a cone-mode sparse checkout has. */
export const lsTreeTopLevelDirectories = (): GitCommand =>
	git(["ls-tree", "-d", "--name-only", "HEAD"]);

// ---------------------------------------------------------------- restoring files (3.11)

export const resetHard = (ref: string): GitCommand => git(["reset", "--hard", ref]);
export const restoreFromSource = (source: string, path: string): GitCommand =>
	git(["restore", `--source=${source}`, "--worktree", "--staged", "--", path]);
/** File row "Discard changes": puts one file back to its committed state (ui-map 3.6). */
export const discardFileChanges = (path: string): GitCommand => restoreFromSource("HEAD", path);
export const restoreStaged = (path: string): GitCommand => git(["restore", "--staged", "--", path]);
export const removeCached = (path: string): GitCommand =>
	git(["rm", "--cached", "--force", "--", path]);

// ---------------------------------------------------------------- git identity and settings

export const configUserName = (): GitCommand => configGet("user.name");
export const configUserEmail = (): GitCommand => configGet("user.email");
export const configPullRebase = (): GitCommand => configGet("pull.rebase");
/** `pull.ff` decides whether a pull may create a merge commit, or only fast-forward. */
export const configPullFf = (): GitCommand => configGet("pull.ff");

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
