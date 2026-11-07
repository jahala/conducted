/**
 * @feature PLAT-40 Branch protection on main: pull requests only, CI must pass
 * Owns: the expected rule (`RULE`), the pure comparison (`protectionProblems`), the `--apply` body
 * (`applyBody`), and reading and writing it with `gh`.
 * Behaviour: docs/plans/release-pipeline.md item 4.
 * Must handle: an unprotected branch, checks set through the older `contexts` list, a refusal from
 * `gh`, and an apply whose write did not take effect.
 * Test first: names a missing pull request rule, names a missing required check, and passes when
 * every rule is set.
 */
export interface BranchRule {
	/** owner/name on GitHub. */
	repo: string;
	branch: string;
	/** True when the branch takes changes only through a pull request. */
	pullRequests: boolean;
	/** The status check names that must pass before a merge. */
	checks: readonly string[];
}

/**
 * The one home of the rule the plan asks for: pull requests only on `main`, and the three CI jobs
 * that must pass (release-pipeline.md item 4).
 */
export const RULE: BranchRule = {
	repo: "jahala/conducted",
	branch: "main",
	pullRequests: true,
	checks: ["typescript", "rust", "harness"],
};

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | null =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

/** The names in a protection answer's required checks, from either the newer or older field. */
function requiredChecks(protection: Json): Set<string> {
	const names = new Set<string>();
	const status = asRecord(protection.required_status_checks);
	if (status === null) return names;
	if (Array.isArray(status.contexts)) {
		for (const context of status.contexts) {
			if (typeof context === "string") names.add(context);
		}
	}
	if (Array.isArray(status.checks)) {
		for (const check of status.checks) {
			const context = asRecord(check)?.context;
			if (typeof context === "string") names.add(context);
		}
	}
	return names;
}

/**
 * What is missing from a branch protection answer, naming each missing rule. A null answer is an
 * unprotected branch. Pure: the same answer and rule always give the same list.
 */
export function protectionProblems(protection: unknown, rule: BranchRule): string[] {
	const answer = asRecord(protection);
	if (answer === null) {
		return [
			`${rule.branch} is not protected`,
			...rule.checks.map((check) => `${rule.branch} does not require the ${check} check`),
		];
	}
	const problems: string[] = [];
	if (rule.pullRequests && asRecord(answer.required_pull_request_reviews) === null) {
		problems.push(`${rule.branch} does not require a pull request`);
	}
	const present = requiredChecks(answer);
	for (const check of rule.checks) {
		if (!present.has(check)) {
			problems.push(`${rule.branch} does not require the ${check} check`);
		}
	}
	return problems;
}

/**
 * The body `gh api -X PUT .../protection` takes. The endpoint requires four fields, so the two the
 * rule does not name are set to their neutral values: branches need not be up to date, admins are
 * not enforced, and no one is restricted from pushing. A pull request is required; no approval is.
 */
export function applyBody(rule: BranchRule): Json {
	return {
		required_status_checks: {
			strict: false,
			checks: rule.checks.map((context) => ({ context })),
		},
		enforce_admins: false,
		required_pull_request_reviews: { required_approving_review_count: 0 },
		restrictions: null,
	};
}

const protectionPath = (rule: BranchRule): string =>
	`repos/${rule.repo}/branches/${rule.branch}/protection`;

interface GhResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Runs `gh` and keeps its streams. This is the edge: nothing here judges the answer. */
function gh(args: string[], input?: string): GhResult {
	const result = Bun.spawnSync(["gh", ...args], {
		stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode ?? 1,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

/**
 * Reads the branch protection. GitHub answers 404 for an unprotected branch; that becomes null so
 * the comparison can name every missing rule rather than stopping the run.
 */
function readProtection(rule: BranchRule): unknown {
	const path = protectionPath(rule);
	const result = gh(["api", path]);
	if (result.exitCode === 0) return JSON.parse(result.stdout) as unknown;
	if (/Branch not protected|HTTP 404/i.test(result.stderr)) return null;
	throw new Error(`gh api ${path} failed:\n${result.stderr.trim()}`);
}

function main(): void {
	const rule = RULE;
	const path = protectionPath(rule);
	const apply = process.argv.includes("--apply");
	try {
		if (apply) {
			const body = applyBody(rule);
			console.log(`Setting branch protection on ${rule.repo} ${rule.branch}:`);
			console.log(JSON.stringify(body, null, 2));
			const written = gh(["api", "-X", "PUT", path, "--input", "-"], `${JSON.stringify(body)}\n`);
			if (written.exitCode !== 0) {
				throw new Error(`setting branch protection failed:\n${written.stderr.trim()}`);
			}
		}
		const problems = protectionProblems(readProtection(rule), rule);
		if (problems.length > 0) {
			console.error(`${rule.repo} ${rule.branch} does not meet the repository rule:`);
			for (const problem of problems) console.error(`  - ${problem}`);
			if (!apply) console.error("Run `pnpm repo-rules --apply` to set it.");
			process.exit(1);
		}
		console.log(`${rule.repo} ${rule.branch} meets the repository rule.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (import.meta.main) main();
