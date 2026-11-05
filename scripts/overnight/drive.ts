/**
 * The overnight step driver's deterministic parts. The conductor session runs the loop in
 * docs/plans/overnight-build.md and calls these subcommands; judgement (grouping CI failures,
 * reading audits) stays with the conductor.
 *
 * Usage:
 *   bun scripts/overnight/drive.ts issues                 map feature ids to issue numbers
 *   bun scripts/overnight/drive.ts plan <batch-id> [--only ID,ID]
 *                                                         write the batch's pleach plan
 *   bun scripts/overnight/drive.ts step <n>               list the step's batch ids
 *   bun scripts/overnight/drive.ts mark-done <tree> <ID...>
 *                                                         set rows to done in <tree>'s backlog,
 *                                                         refusing an id with placeholders left
 *   bun scripts/overnight/drive.ts balance                print the DeepSeek balance in USD
 *   bun scripts/overnight/drive.ts audit-prompt <batch-id> <findings-file>
 *                                                         the read-only audit agent's prompt
 *   bun scripts/overnight/drive.ts fixer-prompt <ID,ID> <log-file>
 *                                                         a fixer's prompt for one failure group
 *
 * Working files go to .context/overnight/ (git-ignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type BacklogRow, parseBacklog } from "../issues/model.ts";
import { placeholdersFor, sourceFiles } from "./node-gate.ts";
import { planBatches } from "./plan-batches.ts";

const root = join(import.meta.dir, "../..");
const work = join(root, ".context/overnight");
mkdirSync(join(work, "plans"), { recursive: true });

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
- Finish with a short message: what you built, which checklist items have tests, and anything you could not do.`;

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
		"- Fix the cause, not the symptom. Never delete, skip or loosen a failing test: make the code right, or fix a test that asserts the wrong thing and say why.",
	].join("\n");
}

const [command, ...args] = process.argv.slice(2);

if (command === "issues") {
	const map: Record<string, number> = {};
	let cursor: string | null = null;
	for (;;) {
		const query = `query($cursor: String) { repository(owner: "jahala", name: "conducted") {
			issues(first: 100, after: $cursor, labels: ["backlog"]) { pageInfo { hasNextPage endCursor } nodes { number body } } } }`;
		const cmd = ["gh", "api", "graphql", "-f", `query=${query}`];
		if (cursor) cmd.push("-f", `cursor=${cursor}`);
		const page = JSON.parse(Bun.spawnSync(cmd, { stdout: "pipe" }).stdout.toString()).data
			.repository.issues;
		for (const node of page.nodes as { number: number; body: string }[]) {
			const id = /<!-- backlog:([A-Z]+-\d{2}) -->/.exec(node.body)?.[1];
			if (id) map[id] = node.number;
		}
		if (!page.pageInfo.hasNextPage) break;
		cursor = page.pageInfo.endCursor;
	}
	writeFileSync(join(work, "issues.json"), JSON.stringify(map, null, 2));
	console.log(`${Object.keys(map).length} feature issues mapped.`);
} else if (command === "step" || command === "plan") {
	const rows = backlog(root).filter((r) => r.status === "stub" && r.priority === 1);
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
		const onlyAt = args.indexOf("--only");
		const only = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? "").split(","));
		const features = batch.features.filter((f) => !only || only.has(f.id));
		const issues = issueMap();
		const plan = {
			goal: `Overnight batch ${batch.id}: ${features.map((f) => f.id).join(", ")}`,
			source: `overnight/${batch.id}`,
			maxConcurrency: 6,
			nodes: features.map((f) => ({
				id: nodeId(f.id),
				worker: { provider: "builder" },
				setup: "pnpm install --frozen-lockfile",
				work: { prompt: promptFor(f, issues.get(f.id)) },
				accept: { smoke: `bun scripts/overnight/node-gate.ts ${f.id}` },
				policy: { maxAttempts: 2, timeoutMs: 45 * 60 * 1000 },
			})),
		};
		const path = join(work, "plans", `${batch.id}${only ? "-trial" : ""}.json`);
		writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
		console.log(relative(root, path));
	}
} else if (command === "mark-done") {
	const [tree, ...ids] = args;
	if (!tree || ids.length === 0) throw new Error("Usage: mark-done <tree> <ID...>");
	const files: [string, string][] = [];
	for (const top of ["apps", "packages", "bin"]) {
		for (const path of sourceFiles(join(tree, top))) files.push([path, readFileSync(path, "utf8")]);
	}
	const path = join(tree, "docs/plans/backlog.md");
	let text = readFileSync(path, "utf8");
	for (const id of ids) {
		if (placeholdersFor(id, files).length > 0) throw new Error(`${id} still has placeholders`);
		const row = new RegExp(`^(\\| ${id} \\|.*\\|\\s*)stub(\\s*\\|[^\\n]*)$`, "m");
		if (!row.test(text)) throw new Error(`${id} has no stub row`);
		text = text.replace(row, "$1done$2");
	}
	writeFileSync(path, text);
	console.log(`Marked done: ${ids.join(", ")}`);
} else if (command === "balance") {
	const response = await fetch("https://api.deepseek.com/user/balance", {
		headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY ?? ""}` },
	});
	const body = (await response.json()) as {
		balance_infos: { currency: string; total_balance: string }[];
	};
	console.log(body.balance_infos.find((b) => b.currency === "USD")?.total_balance ?? "unknown");
} else if (command === "audit-prompt") {
	const [batchId, findings] = args;
	const rows = backlog(root).filter((r) => r.status !== "planned" && r.priority === 1);
	const batch = planBatches(rows).find((b) => b.id === batchId);
	if (!batch || !findings) throw new Error("Usage: audit-prompt <batch-id> <findings-file>");
	const onlyAt = args.indexOf("--only");
	const only = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? "").split(","));
	const features = batch.features.filter((f) => !only || only.has(f.id));
	console.log(auditPrompt(batch.id, features, issueMap(), findings));
} else if (command === "fixer-prompt") {
	const [ids, logFile] = args;
	if (!ids || !logFile) throw new Error("Usage: fixer-prompt <ID,ID> <log-file>");
	console.log(fixerPrompt(ids.split(","), readFileSync(logFile, "utf8")));
} else {
	console.error(
		"Usage: drive.ts issues | plan <batch> [--only IDS] | step <n> | mark-done <tree> <IDS> | balance | audit-prompt <batch> <file> | fixer-prompt <IDS> <log>",
	);
	process.exit(64);
}
