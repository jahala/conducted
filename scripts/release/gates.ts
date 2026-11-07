/**
 * The release's check that needs no tools, so it can be tested: whether main's CI passed for the
 * commit being released.
 *
 * The owner's ruling (2026-11-06): "`pnpm release` trusts main's green CI, runs no tests here". So
 * the release refuses a HEAD that is not origin/main, or whose newest "CI" run is missing, still
 * running or not a success.
 */

export type GateResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

const fail = (message: string): GateResult<never> => ({ ok: false, error: { message } });

/** One workflow run, as `gh run list --json name,headSha,status,conclusion` gives it, newest first. */
export interface CiRun {
	name: string;
	headSha: string;
	status: string;
	conclusion: string;
}

/** The workflow whose success a release needs. */
export const CI_WORKFLOW = "CI";

export function ciGate(input: {
	head: string;
	mainHead: string;
	runs: readonly CiRun[];
}): GateResult<void> {
	if (input.head !== input.mainHead) {
		return fail(`HEAD ${input.head} is not origin/main (${input.mainHead}). Pull, then release.`);
	}
	const run = input.runs.find((r) => r.name === CI_WORKFLOW && r.headSha === input.head);
	if (run === undefined) return fail(`CI has not run for ${input.head}.`);
	if (run.status !== "completed") return fail(`CI for ${input.head} is still running.`);
	if (run.conclusion !== "success") {
		return fail(`CI for ${input.head} ended in ${run.conclusion}, not success.`);
	}
	return { ok: true, value: undefined };
}
