/**
 * The overnight step driver's deterministic parts. The conductor session runs the loop in
 * docs/plans/overnight-build.md and calls these subcommands; judgement (grouping CI failures,
 * reading audits) stays with the conductor.
 *
 * Usage:
 *   bun scripts/overnight/drive.ts issues                 map feature ids to issue numbers
 *   bun scripts/overnight/drive.ts plan <batch-id> --night <n> [--only ID,ID] [--max <m>]
 *                                                         write night step n's pleach plan for the
 *                                                         batch, at most m workers at once, and the
 *                                                         batch's feature ids beside it
 *   bun scripts/overnight/drive.ts step <n> [--priority <p>]               list the step's batch ids
 *   bun scripts/overnight/drive.ts preflight              the quick gate on the step branch itself,
 *                                                         before any worker starts from it
 *   bun scripts/overnight/drive.ts mark-done <tree> <ID...>
 *                                                         set rows to done in <tree>'s backlog,
 *                                                         refusing an id with placeholders left,
 *                                                         then run the guards on <tree>
 *   bun scripts/overnight/drive.ts balance                print the DeepSeek balance in USD
 *   bun scripts/overnight/drive.ts audit-prompt <ids-file> <findings-file>
 *                                                         the read-only audit agent's prompt for the
 *                                                         batch whose ids plan wrote
 *   bun scripts/overnight/drive.ts closes <ID...>         the step PR's "Closes #N" lines (D041)
 *   bun scripts/overnight/drive.ts fixer-prompt <ID,ID> <log-file>
 *                                                         a fixer's prompt for one failure group
 *
 * Working files go to .context/overnight/ (git-ignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { type BacklogRow, parseBacklog } from "../issues/model.ts";
import { placeholdersFor, readSources } from "./node-gate.ts";
import { type Batch, buildableRows, planBatches } from "./plan-batches.ts";

const root = join(import.meta.dir, "../..");
const work = join(root, ".context/overnight");

export const READ_FIRST = `Read these first, in order, before you change anything:
1. CLAUDE.md, docs/architecture.md, docs/engineering.md and docs/decisions.md.
2. If your feature touches a screen: docs/design.md and docs/research/conductor/ui-dimensions.md. If it touches stored data: docs/data-model.md.
3. Your GitHub issue (command below): its checklist, owning files, "Test first" lines and blockers.
4. The research sections your issue cites, in docs/research/conductor/.`;

export const RULES = `Rules:
- Change only the files your issue owns, plus new test files next to them. Never edit docs/plans/backlog.md or any other doc outside your owning files: the conductor marks your feature done after CI passes. If you need anything outside them, finish what you can and say so in your final message.
- Never edit a shared contract: packages/protocol, packages/shared, apps/desktop/src/platform/platform.ts, apps/desktop/src/core/model.ts, apps/desktop/src/core/api.ts, apps/desktop/src-tauri/migrations. If the feature cannot be built without a contract change, stop and say exactly what change is needed.
- Tests first: write tests for the checklist items, then build until the code would make them pass. Name your feature id in every describe title, for example describe("{ID} ..."). In Rust, start each #[test] function name with the id in snake case, for example fn {SNAKE}_runs_a_command().
- Remove every notImplemented("{ID}") / not_implemented!("{ID}") placeholder for your feature, and only those.
- Do not run the test suite or build Rust: tests run on GitHub after the batch. Run pnpm typecheck, pnpm lint and pnpm guards before you stop.
- Never run git commit, git push or anything with --no-verify. Use trash, never rm.
- Match Conductor in everything a user sees or does (D020, D022), in our own words and code (D002).
- The rules the audits enforce most, all in docs/engineering.md: your file headers say only what the code does (cut or move the claims you did not build); no silent failures (no empty catch, no catch that returns null, no unread Result, no invented default); an async read that writes a store lets only the newest answer win (createLatestWins), with a test of two overlapping calls; your code is called from a live path, or the wiring is a checklist item on the feature that owns the caller; use the shared helpers in docs/architecture.md (Shared helpers) instead of writing your own; whatever subscribes has a dispose; fakes hand out a new id on every call; screen tests use createTestContainer from apps/desktop/src/test/container.ts.
- Reach it from the real app (D054): wire every service, hook or component you build into its composition root in this change (apps/desktop/src/core/container.ts, packages/sidecar/src/modes/sidecar-mode.ts, the router, or the screen that shows it), and add one test over createTestContainer (apps/desktop/src/test/container.ts) or the real sidecar host that reaches it. A dependency your tests pass in is passed by the composition root too. Take stand-ins from apps/desktop/src/test/ or the sidecar's test support, never a new fake in your test file. Never assert placeholder text or a backlog status. Test a shortcut by pressing its key into the mounted root dispatcher. Format any Markdown you write with pnpm exec biome format --write.
- Finish with a short message: what you built, which checklist items have tests, and anything you could not do.`;

/**
 * A batch of two or more features in the TypeScript areas ends in a joining node (D054, and the
 * pleach-plan skill's integration node): the siblings are built in parallel, so only a node that
 * sees them merged can check that the composition root reaches each one. Rust batches have no
 * joining node: their merges have been lockfile-only, and their integration test needs a build.
 */
export function needsJoin(program: string, featureCount: number): boolean {
	return program !== "rust" && featureCount >= 2;
}

export function joinNodeId(batchId: string): string {
	return `join.${batchId}`;
}

/** The joining node's prompt: merge, wire into the composition root, one integration test. */
export function joinPromptFor(batchId: string, area: string, features: BacklogRow[]): string {
	const root =
		area === "sidecar"
			? "packages/sidecar/src/modes/sidecar-mode.ts (and the handlers it builds)"
			: "apps/desktop/src/core/container.ts for services, and the router or the screen that shows each part for UI";
	const testFile =
		area === "sidecar"
			? `packages/sidecar/src/modes/${batchId}.join.test.ts`
			: `apps/desktop/src/core/${batchId}.join.test.ts`;
	return [
		`You join batch ${batchId} of Conducted, a macOS app for running coding agents in parallel (repo jahala/conducted). Other agents built these features side by side, and this worktree already merges their verified branches: ${features.map((f) => `${f.id} ${f.title}`).join("; ")}.`,
		"",
		READ_FIRST,
		"",
		"Your job, in order:",
		"1. Resolve every merge conflict marker left in the tree, keeping both features' work: never two definitions of one thing, and the real implementation over a placeholder. Combine file headers so they claim only what the merged code does.",
		`2. Check that each feature is reached from the real composition root: ${root}. Wire any dependency or component a feature built but nothing passes or mounts (D054).`,
		"3. Look for logic two features each wrote (a helper, a parser, a query) and keep one, pointing the other's callers at it.",
		`4. Write ${testFile}: one integration test file, describe("${batchId} join ..."), that drives each feature of the batch at least once through the composition root, over createTestContainer from apps/desktop/src/test/container.ts${area === "sidecar" ? " or the real sidecar host and handlers" : ""}. Each test must fail if its feature's wiring were removed.`,
		"",
		RULES.replaceAll("{ID}", features[0]?.id ?? "").replaceAll(
			"{SNAKE}",
			(features[0]?.id ?? "").toLowerCase().replace("-", "_"),
		),
		"- You may edit the composition roots, the files with conflict markers, and your integration test file. Change no feature's behaviour beyond wiring and merging; if a feature is wrong, say so in your final message instead.",
	].join("\n");
}

export function nodeId(id: string): string {
	return id.toLowerCase().replace("-", ".");
}

export function promptFor(row: BacklogRow, issue: number | undefined): string {
	const view = issue
		? `gh issue view ${issue} --repo jahala/conducted`
		: `the backlog row ${row.id} in docs/plans/backlog.md`;
	return [
		`You are building one feature of Conducted, a macOS app for running coding agents in parallel (repo jahala/conducted). Feature: ${row.id} ${row.title}.`,
		"",
		READ_FIRST,
		"",
		`Your issue: ${view}`,
		"",
		RULES.replaceAll("{ID}", row.id).replaceAll("{SNAKE}", row.id.toLowerCase().replace("-", "_")),
	].join("\n");
}

function backlog(at: string): BacklogRow[] {
	return parseBacklog(readFileSync(join(at, "docs/plans/backlog.md"), "utf8"));
}

function issueMap(): Map<string, number> {
	const path = join(work, "issues.json");
	return new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, number>));
}

export function auditPrompt(
	batchId: string,
	features: BacklogRow[],
	issues: Map<string, number>,
	findings: string,
): string {
	const list = features.map(
		(f) =>
			`- ${f.id} ${f.title} (gh issue view ${issues.get(f.id) ?? "?"} --repo jahala/conducted)`,
	);
	return [
		`You are auditing batch ${batchId} of Conducted, a macOS app for running coding agents in parallel. The batch's features were just built by other agents and CI is green. You change no files except your findings file.`,
		"",
		READ_FIRST.replace(
			'3. Your GitHub issue (command below): its checklist, owning files, "Test first" lines and blockers.',
			'3. Each feature\'s GitHub issue (listed below): its checklist, owning files and "Test first" lines.',
		),
		"",
		"The features:",
		...list,
		"",
		"For each feature, check and report:",
		"1. Does it look and behave like Conductor (D020, D022), per its issue and the research it cites?",
		"2. Do the specs (file headers, issue checklist) and the code agree?",
		"3. Does every checklist item have a real test that would fail without the feature? Name items with no test.",
		"4. Is any logic duplicated, within the batch or with existing code? Name both places.",
		"5. Was anything skipped or left half done (a placeholder removed without the behaviour, a test that asserts nothing)?",
		"6. Does every file header claim only what the code does? List each header line (Owns, Must handle, Our design choice) that the code does not keep.",
		"7. Check the rules in docs/engineering.md (Code and Tests) one by one: silent failures, newest-answer guards, code no live path calls, copies of the shared helpers in docs/architecture.md, listeners with no dispose, fakes that repeat ids.",
		"Mark each finding MUST or LATER. MUST: a bug, a header claim the code does not keep, a banned pattern (compatibility alias, invented default, fake success, silent fallback), duplicated logic, an unsafe read or write. LATER: everything else. End with a line starting 'Summary:'.",
		"Read only. Never run git checkout, switch, reset, stash or any git command that changes the working tree or HEAD: other agents work in this folder.",
		"",
		`Write your findings to ${findings} as a Markdown list grouped by feature id. Each finding: the file and line, what is wrong, and what would fix it. Write "none" for a clean feature. Do not edit any other file, do not run git commit or git push, and do not run the test suite. Finish with a one-line summary: how many findings per feature.`,
	].join("\n");
}

export function fixerPrompt(ids: string[], log: string): string {
	return [
		`You are fixing one group of failures in Conducted, a macOS app for running coding agents in parallel (repo jahala/conducted). Features: ${ids.join(", ")}.`,
		"",
		READ_FIRST.replace(
			"3. Your GitHub issue (command below)",
			'3. The GitHub issues of these features (gh issue list --repo jahala/conducted --search "<id> in:title")',
		),
		"",
		"What failed (from CI or from the batch audit):",
		"",
		"```",
		log.slice(0, 12_000),
		"```",
		"",
		RULES.replaceAll("{ID}", ids[0] ?? "").replaceAll(
			"{SNAKE}",
			(ids[0] ?? "").toLowerCase().replace("-", "_"),
		),
		...(ids.length > 1
			? [
					`- The rules above name ${ids[0]} as the example. They apply the same way to each of ${ids.join(", ")}: keep each feature's id in its test titles and remove only that feature's placeholders.`,
				]
			: []),
		"- Fix the cause, not the symptom. Never delete, skip or loosen a failing test: make the code right, or fix a test that asserts the wrong thing and say why.",
	].join("\n");
}

/** The value after a flag, or undefined when the flag is absent or has no value. */
function flag(args: string[], name: string): string | undefined {
	const at = args.indexOf(name);
	const value = at === -1 ? undefined : args[at + 1];
	return value?.startsWith("--") ? undefined : value;
}

/** Runs `gh` and returns its output. A failed call stops the command with gh's own message. */
function gh(cmd: string[]): string {
	const run = Bun.spawnSync(["gh", ...cmd], { stdout: "pipe", stderr: "pipe" });
	if (run.exitCode !== 0) throw new Error(`gh ${cmd[0]} failed:\n${run.stderr.toString()}`);
	return run.stdout.toString();
}

/** The DeepSeek balance in USD. A missing key or a refused call is an error, never a guess. */
export async function deepseekBalance(
	key: string | undefined,
	fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
	if (!key) throw new Error("DEEPSEEK_API_KEY is not set");
	const response = await fetcher("https://api.deepseek.com/user/balance", {
		headers: { Authorization: `Bearer ${key}` },
	});
	if (!response.ok) throw new Error(`DeepSeek balance call failed: HTTP ${response.status}`);
	const body = (await response.json()) as {
		balance_infos?: { currency: string; total_balance: string }[];
	};
	const usd = body.balance_infos?.find((b) => b.currency === "USD")?.total_balance;
	if (usd === undefined) throw new Error("DeepSeek reported no USD balance");
	return usd;
}

/** The batch's features, after `--only`. An id the batch does not hold is an error. */
export function selectFeatures(batch: Batch, only: string | undefined): BacklogRow[] {
	if (only === undefined) return batch.features;
	const wanted = only.split(",");
	const unknown = wanted.filter((id) => !batch.features.some((f) => f.id === id));
	if (unknown.length > 0) throw new Error(`${batch.id} does not hold ${unknown.join(", ")}`);
	return batch.features.filter((f) => wanted.includes(f.id));
}

/** Sets stub rows to done in backlog text. Refuses an id with no stub row. */
/** Runs `pnpm -s <script>` in `cwd`. */
function pnpmScript(cwd: string, script: string): CheckRun {
	const run = Bun.spawnSync(["pnpm", "-s", script], { cwd, stdout: "pipe", stderr: "pipe" });
	return { exitCode: run.exitCode, output: `${run.stdout.toString()}${run.stderr.toString()}` };
}

/** One quick check's exit code and its combined output. */
export interface CheckRun {
	exitCode: number;
	output: string;
}

/** The quick gate the step branch must pass: the same three every worker runs before it stops. */
export const QUICK_CHECKS = ["typecheck", "lint", "guards"] as const;

/**
 * Runs the quick checks in order through `spawn` and stops at the first that fails. Null when all
 * pass. Preflight runs all three; mark-done runs the guards, because rows set to done bring their
 * files into the guards' scope (test-only-exports skips a stub feature's files).
 */
export function runQuickChecks(
	spawn: (script: string) => CheckRun,
	scripts: readonly string[] = QUICK_CHECKS,
): { script: string; output: string } | null {
	for (const script of scripts) {
		const run = spawn(script);
		if (run.exitCode !== 0) return { script, output: run.output };
	}
	return null;
}

export function markDone(text: string, ids: string[]): string {
	let next = text;
	for (const id of ids) {
		if (!/^[A-Z]+-\d{2}$/.test(id)) throw new Error(`${id} is not a feature id`);
		const row = new RegExp(`^(\\| ${id}\\s+\\|.*\\|\\s*)stub(\\s*\\|[^\\n]*)$`, "m");
		if (!row.test(next)) throw new Error(`${id} has no stub row`);
		next = next.replace(row, "$1done$2");
	}
	return next;
}

async function main(command: string | undefined, args: string[]): Promise<void> {
	if (command === "issues") {
		const map: Record<string, number> = {};
		let cursor: string | null = null;
		for (;;) {
			const query = `query($cursor: String) { repository(owner: "jahala", name: "conducted") {
			issues(first: 100, after: $cursor, labels: ["backlog"]) { pageInfo { hasNextPage endCursor } nodes { number body } } } }`;
			const cmd = ["api", "graphql", "-f", `query=${query}`];
			if (cursor) cmd.push("-f", `cursor=${cursor}`);
			const page = JSON.parse(gh(cmd)).data.repository.issues;
			for (const node of page.nodes as { number: number; body: string }[]) {
				const id = /<!-- backlog:([A-Z]+-\d{2}) -->/.exec(node.body)?.[1];
				if (id) map[id] = node.number;
			}
			if (!page.pageInfo.hasNextPage) break;
			cursor = page.pageInfo.endCursor;
		}
		mkdirSync(work, { recursive: true });
		writeFileSync(join(work, "issues.json"), JSON.stringify(map, null, 2));
		console.log(`${Object.keys(map).length} feature issues mapped.`);
	} else if (command === "step" || command === "plan") {
		const maxPriority = Number(flag(args, "--priority") ?? 1);
		const rows = buildableRows(backlog(root), maxPriority);
		const batches = planBatches(rows);
		if (command === "step") {
			console.log(
				batches
					.filter((b) => b.step === Number(args[0]))
					.map((b) => b.id)
					.join("\n"),
			);
		} else {
			const batch = batches.find((b) => b.id === args[0]);
			if (!batch) throw new Error(`No batch ${args[0]}`);
			const night = flag(args, "--night");
			if (!night) throw new Error("plan needs --night <n>, the night's step number");
			const max = Number(flag(args, "--max") ?? 6);
			if (!Number.isInteger(max) || max < 1)
				throw new Error("--max needs a whole number of 1 or more");
			const features = selectFeatures(batch, flag(args, "--only"));
			const issues = issueMap();
			const plan = {
				goal: `Overnight batch ${batch.id}: ${features.map((f) => f.id).join(", ")}`,
				source: `overnight/${batch.id}`,
				maxConcurrency: max,
				nodes: [
					...features.map((f) => ({
						id: nodeId(f.id),
						worker: { provider: "builder" },
						setup: "pnpm install --frozen-lockfile",
						work: { prompt: promptFor(f, issues.get(f.id)) },
						accept: { smoke: `bun scripts/overnight/node-gate.ts ${f.id}` },
						policy: { maxAttempts: 2, timeoutMs: 45 * 60 * 1000 },
					})),
					...(needsJoin(batch.program, features.length)
						? [
								{
									id: joinNodeId(batch.id),
									needs: features.map((f) => nodeId(f.id)),
									worker: { provider: "builder" },
									setup: "pnpm install --frozen-lockfile",
									work: { prompt: joinPromptFor(batch.id, batch.program, features) },
									accept: {
										smoke: `bun scripts/overnight/node-gate.ts ${features.map((f) => f.id).join(" ")}`,
									},
									policy: { maxAttempts: 2, timeoutMs: 45 * 60 * 1000 },
								},
							]
						: []),
				],
			};
			mkdirSync(join(work, "plans"), { recursive: true });
			const base = join(work, "plans", `n${night}-${batch.id}`);
			writeFileSync(`${base}.json`, `${JSON.stringify(plan, null, 2)}\n`);
			writeFileSync(`${base}.ids`, `${features.map((f) => f.id).join("\n")}\n`);
			console.log(relative(root, `${base}.json`));
		}
	} else if (command === "preflight") {
		// Every node starts from the step branch, so a red check here fails every node at once.
		const failed = runQuickChecks((script) => pnpmScript(root, script));
		if (failed !== null) {
			console.error(failed.output.slice(-4000));
			console.error(`preflight: pnpm ${failed.script} failed on the step branch; start no worker.`);
			process.exit(1);
		}
		console.log(`ok   ${QUICK_CHECKS.join(", ")}`);
	} else if (command === "mark-done") {
		const [tree, ...ids] = args;
		if (!tree || ids.length === 0) throw new Error("Usage: mark-done <tree> <ID...>");
		const files = readSources(tree);
		for (const id of ids) {
			if (placeholdersFor(id, files).length > 0) throw new Error(`${id} still has placeholders`);
		}
		const path = join(tree, "docs/plans/backlog.md");
		writeFileSync(path, markDone(readFileSync(path, "utf8"), ids));
		console.log(`Marked done: ${ids.join(", ")}`);
		// Done rows bring their files into the guards' scope, so a guard can go red only now.
		const failed = runQuickChecks((script) => pnpmScript(tree, script), ["guards"]);
		if (failed !== null) {
			console.error(failed.output.slice(-4000));
			console.error("mark-done: the guards fail with these rows done; fix that before the PR.");
			process.exit(1);
		}
	} else if (command === "balance") {
		console.log(await deepseekBalance(process.env.DEEPSEEK_API_KEY));
	} else if (command === "audit-prompt") {
		const [idsFile, findings] = args;
		if (!idsFile || !findings) throw new Error("Usage: audit-prompt <ids-file> <findings-file>");
		const ids = readFileSync(idsFile, "utf8").split("\n").filter(Boolean);
		const rows = new Map(backlog(root).map((r) => [r.id, r]));
		const features = ids.map((id) => {
			const row = rows.get(id);
			if (!row) throw new Error(`${id} is not in the backlog`);
			return row;
		});
		const batchId = basename(idsFile, ".ids");
		console.log(auditPrompt(batchId, features, issueMap(), findings));
	} else if (command === "closes") {
		if (args.length === 0) throw new Error("Usage: closes <ID...>");
		const issues = issueMap();
		for (const id of args) {
			const number = issues.get(id);
			if (!number) throw new Error(`${id} has no issue in issues.json`);
			console.log(`Closes #${number}`);
		}
	} else if (command === "fixer-prompt") {
		const [ids, logFile] = args;
		if (!ids || !logFile) throw new Error("Usage: fixer-prompt <ID,ID> <log-file>");
		console.log(fixerPrompt(ids.split(","), readFileSync(logFile, "utf8")));
	} else {
		console.error(
			"Usage: drive.ts issues | plan <batch> --night <n> [--only IDS] [--max <m>] | step <n> | preflight | mark-done <tree> <IDS> | balance | audit-prompt <ids-file> <file> | closes <IDS> | fixer-prompt <IDS> <log>",
		);
		process.exit(64);
	}
}

if (import.meta.main) {
	const [command, ...args] = process.argv.slice(2);
	main(command, args).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
