/**
 * @feature PR-08 PR and stack range diffs
 * Owns: turning a stack's pull requests into ranges, resolving each range in the workspace's
 * repository, and choosing the run of pull requests a range view compares.
 * Behaviour: services-map.md 3.4.5 (`Ctt`): both commit ids of each pull request are checked with
 * `rev-parse --verify --quiet <oid>^0` (exit 0 present, 1 missing, any other code an error); the
 * missing ones are fetched by branch name; the range starts at `merge-base <base> <head>`; each pull
 * request comes back resolved, or unresolved with `missing-head` or `missing-base`. services-map.md
 * 3.4.1 (view mode `range`: from the start commit to the head commit).
 * Where the research is silent, Conductor's own code decides: only open pull requests take part,
 * and each is based on the open one below it (`gJt`); a run is a block of adjacent pull requests,
 * from the bottom one's start to the top one's head, or to the working tree when the top one is
 * the checked-out branch (`AJt`, `PJt`).
 * Must handle: a commit id that git could read as an option (refused before any command), an id
 * listed twice (checked once), a fetch that fails (the pull requests stay unresolved and the
 * failure is handed back), a merge base git cannot find (an error, as in Conductor), a selection
 * that is only the checked-out pull request or names none of the stack's (the checked-out branch),
 * pull requests that are not adjacent, and a bottom or top pull request whose commits are missing.
 * Our design choice: the fetch is a parameter, so the caller owns how often it may run.
 * Test first: a stack whose head commits are only on the remote resolves after one fetch of their
 * branches, each from the merge base of its base and head.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { mergeBase, revParseVerify } from "./commands.ts";
import type { GitRunner } from "./runner.ts";

/** One member of a GitHub stack, as far as a range needs it, from trunk up. */
export interface StackRangeMember {
	number: number;
	branch: string;
	state: "open" | "draft" | "merged" | "closed";
	headSha: string;
	baseSha: string;
	baseBranch: string;
}

/** One pull request of a stack, with the branch and commit at each end of its range. */
export interface RangePullRequest {
	prNumber: number;
	headBranch: string;
	headOid: string;
	baseBranch: string;
	baseOid: string;
}

export type PullRequestRange = RangePullRequest & { isLive: boolean } & (
		| { status: "resolved"; fromOid: string }
		| { status: "unresolved"; reason: "missing-head" | "missing-base" }
	);

export interface PullRequestRanges {
	pullRequests: PullRequestRange[];
	/** Why the fetch of missing commits failed, or null when it ran or was not needed. */
	fetchError: AppError | null;
}

/**
 * The open pull requests of a stack, from trunk up. Each one is based on the open one below it, so
 * a merged or closed pull request in between does not leave a gap; the lowest keeps its own base.
 */
export function stackRangePullRequests(members: readonly StackRangeMember[]): RangePullRequest[] {
	const open = members.filter((member) => member.state === "open" || member.state === "draft");
	return open.map((member, index) => {
		const below = index === 0 ? undefined : open[index - 1];
		return {
			prNumber: member.number,
			headBranch: member.branch,
			headOid: member.headSha,
			baseBranch: below?.branch ?? member.baseBranch,
			baseOid: below?.headSha ?? member.baseSha,
		};
	});
}

/** A commit id GitHub reported: hexadecimal only, so git cannot read it as an option. */
const OBJECT_ID = /^[0-9a-f]{4,64}$/i;

export interface ResolveRangesInput {
	/** The workspace folder. */
	cwd: string;
	pullRequests: readonly RangePullRequest[];
	/** The branch checked out in the workspace. Its pull request is read from the working tree. */
	liveBranch: string;
	/** Fetches these branches from the remote. Called at most once, only when a commit is missing. */
	fetchBranches: (branches: readonly string[]) => Promise<Result<void>>;
}

export async function resolvePullRequestRanges(
	runner: GitRunner,
	input: ResolveRangesInput,
): Promise<Result<PullRequestRanges>> {
	const ends = input.pullRequests.flatMap((pullRequest) => [
		{ oid: pullRequest.baseOid, branch: pullRequest.baseBranch },
		{ oid: pullRequest.headOid, branch: pullRequest.headBranch },
	]);
	for (const end of ends) {
		if (!OBJECT_ID.test(end.oid)) {
			return err(appError("git_bad_revision", `"${end.oid}" is not a commit id.`));
		}
	}

	const present = await presentCommits(
		runner,
		input.cwd,
		ends.map((end) => end.oid),
	);
	if (!present.ok) return present;

	let fetchError: AppError | null = null;
	const missing = ends.filter((end) => !present.value.has(end.oid));
	if (missing.length > 0) {
		const branches = [...new Set(missing.map((end) => end.branch))];
		const fetched = await input.fetchBranches(branches);
		if (!fetched.ok) fetchError = fetched.error;
		const found = await presentCommits(
			runner,
			input.cwd,
			missing.map((end) => end.oid),
		);
		if (!found.ok) return found;
		for (const oid of found.value) present.value.add(oid);
	}

	const pullRequests: PullRequestRange[] = [];
	for (const pullRequest of input.pullRequests) {
		const isLive = pullRequest.headBranch === input.liveBranch;
		if (!present.value.has(pullRequest.headOid)) {
			pullRequests.push({ ...pullRequest, isLive, status: "unresolved", reason: "missing-head" });
			continue;
		}
		if (!present.value.has(pullRequest.baseOid)) {
			pullRequests.push({ ...pullRequest, isLive, status: "unresolved", reason: "missing-base" });
			continue;
		}
		const fromOid = await mergeBaseOf(runner, input.cwd, pullRequest.baseOid, pullRequest.headOid);
		if (!fromOid.ok) return fromOid;
		pullRequests.push({ ...pullRequest, isLive, status: "resolved", fromOid: fromOid.value });
	}
	return ok({ pullRequests, fetchError });
}

/** Which of these commits the repository has. Each id is checked once. */
async function presentCommits(
	runner: GitRunner,
	cwd: string,
	oids: readonly string[],
): Promise<Result<Set<string>>> {
	const unique = [...new Set(oids)];
	const answers = await Promise.all(
		unique.map((oid) => runner.run(revParseVerify(`${oid}^0`), { cwd })),
	);
	const present = new Set<string>();
	for (const [index, answer] of answers.entries()) {
		if (!answer.ok) return answer;
		const oid = unique[index] as string;
		if (answer.value.exitCode === 0) present.add(oid);
		else if (answer.value.exitCode !== 1) {
			return err(
				appError(
					"git_failed",
					answer.value.stderr.trim() ||
						`git rev-parse --verify ${oid} exited with code ${answer.value.exitCode}`,
				),
			);
		}
	}
	return ok(present);
}

async function mergeBaseOf(
	runner: GitRunner,
	cwd: string,
	baseOid: string,
	headOid: string,
): Promise<Result<string>> {
	const answer = await runner.run(mergeBase(baseOid, headOid), { cwd });
	if (!answer.ok) return answer;
	const oid = answer.value.stdout.trim();
	if (answer.value.exitCode !== 0 || oid === "") {
		return err(
			appError(
				"git_failed",
				answer.value.stderr.trim() || `Failed to find the merge base of ${baseOid} and ${headOid}`,
			),
		);
	}
	return ok(oid);
}

/** What a selection of a stack's pull requests compares. */
export type StackRunSelection =
	/** Nothing of the stack, or only the checked-out pull request: the branch's own changes. */
	| { kind: "checkedOut" }
	| { kind: "nonAdjacent" }
	/** The commits of this pull request are not in the workspace. */
	| { kind: "unavailable"; prNumber: number }
	| {
			kind: "run";
			bottom: PullRequestRange & { status: "resolved" };
			top: PullRequestRange;
	  };

/** The run of adjacent pull requests a selection names, in the stack's order from trunk up. */
export function selectStackRun(
	rungs: readonly PullRequestRange[],
	selectedPrNumbers: readonly number[],
): StackRunSelection {
	const selected = new Set(selectedPrNumbers);
	const indexes = rungs.flatMap((rung, index) => (selected.has(rung.prNumber) ? [index] : []));
	const first = indexes[0];
	const last = indexes.at(-1);
	if (first === undefined || last === undefined) return { kind: "checkedOut" };
	const bottom = rungs[first] as PullRequestRange;
	const top = rungs[last] as PullRequestRange;
	if (bottom === top && bottom.isLive) return { kind: "checkedOut" };
	if (indexes.length !== last - first + 1) return { kind: "nonAdjacent" };
	if (bottom.status === "unresolved") return { kind: "unavailable", prNumber: bottom.prNumber };
	if (!top.isLive && top.status === "unresolved" && top.reason === "missing-head") {
		return { kind: "unavailable", prNumber: top.prNumber };
	}
	return { kind: "run", bottom, top };
}

/**
 * The two points a run compares: the bottom pull request's start, and the top one's head, or the
 * working tree (null) when the top one is the checked-out branch.
 */
export function stackRunComparison(run: Extract<StackRunSelection, { kind: "run" }>): {
	from: string;
	to: string | null;
} {
	return { from: run.bottom.fromOid, to: run.top.isLive ? null : run.top.headOid };
}
