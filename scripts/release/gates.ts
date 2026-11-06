/**
 * The release's checks that need no tools, so they can be tested: whether main's CI passed for the
 * commit being released, and which keychain identity signs it.
 *
 * The owner's ruling (2026-11-06): "`pnpm release` trusts main's green CI, runs no tests here". So
 * the release refuses a HEAD that is not origin/main, or whose newest "CI" run is missing, still
 * running or not a success.
 *
 * Signing uses the Developer ID Application identity whose certificate expires last, named by its
 * hash: a keychain can hold several valid identities with the same name, and codesign refuses a name
 * that matches more than one ("ambiguous").
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

export interface Identity {
	hash: string;
	name: string;
}

/** Reads `security find-identity -v -p codesigning`: one `N) <hash> "<name>"` line per identity. */
export function parseIdentities(output: string): Identity[] {
	const identities: Identity[] = [];
	for (const line of output.split("\n")) {
		const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			identities.push({ hash: match[1], name: match[2] });
		}
	}
	return identities;
}

const DEVELOPER_ID = "Developer ID Application:";

/** The Developer ID Application identity whose certificate expires last, as its hash. */
export function pickSigningIdentity(
	identities: readonly (Identity & { notAfter: Date })[],
): GateResult<string> {
	const candidates = identities
		.filter((identity) => identity.name.startsWith(DEVELOPER_ID))
		.sort((a, b) => b.notAfter.getTime() - a.notAfter.getTime());
	const best = candidates[0];
	if (best === undefined) {
		return fail(
			`No "${DEVELOPER_ID}" identity is in the keychain, so the release cannot be signed.`,
		);
	}
	return { ok: true, value: best.hash };
}
