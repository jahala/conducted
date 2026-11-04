/**
 * Creates and updates GitHub issues from the backlog, the item map and the file headers.
 * Plan: docs/plans/github-issues.md.
 *
 * Usage:
 *   bun scripts/issues/sync.ts            dry run: writes every issue to .context/issues-draft/ and
 *                                         prints what it would create or change on GitHub
 *   bun scripts/issues/sync.ts --apply    creates labels, milestones, epics and feature issues,
 *                                         updates generated text, links sub-issues and blockers
 *   bun scripts/issues/sync.ts --apply --only A-01,B-02   the same, for those ids only
 *   bun scripts/issues/sync.ts --check    fails when a done row's issue is open, or a closed
 *                                         issue's row is not done (CI)
 *
 * It never closes issues, and it keeps everything below the generated marker in an issue body.
 * It stops at the first failed GitHub call.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	areaLabel,
	type BacklogRow,
	GENERATED_END,
	type Item,
	issueTitle,
	labelsOf,
	milestoneOf,
	type OwningFile,
	parseBacklog,
	parseHeader,
	parseItems,
	renderIssue,
} from "./model.ts";

const root = join(import.meta.dir, "../..");
const repo = "jahala/conducted";
const apply = process.argv.includes("--apply");
const check = process.argv.includes("--check");
const draftDir = join(root, ".context/issues-draft");

// ---------------------------------------------------------------- read the sources

const allRows = parseBacklog(readFileSync(join(root, "docs/plans/backlog.md"), "utf8"));
/** `--only A-01,B-02` limits the run to those ids and their epics (for a small first batch). */
const onlyArg = process.argv[process.argv.indexOf("--only") + 1];
const only = process.argv.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;
const rows = only ? allRows.filter((r) => only.has(r.id)) : allRows;

const items = new Map<string, Item[]>();
const itemsDir = join(root, "docs/plans/items");
for (const name of readdirSync(itemsDir).filter((n) => n.endsWith(".tsv"))) {
	for (const item of parseItems(readFileSync(join(itemsDir, name), "utf8"))) {
		items.set(item.id, [...(items.get(item.id) ?? []), item]);
	}
}

const files = new Map<string, OwningFile[]>();
function walk(dir: string): void {
	for (const name of readdirSync(dir)) {
		if (["node_modules", "dist", "target", "gen", ".git"].includes(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path);
		else if (/\.(ts|tsx|rs|sh)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
			const { ids, file } = parseHeader(relative(root, path), readFileSync(path, "utf8"));
			for (const id of ids) files.set(id, [...(files.get(id) ?? []), file]);
		}
	}
}
for (const top of ["apps", "packages", "bin"]) walk(join(root, top));

const unknownItems = [...items.keys()].filter((id) => !allRows.some((r) => r.id === id));
if (unknownItems.length > 0) {
	console.error(`Item map names ids missing from the backlog: ${unknownItems.join(", ")}`);
	process.exit(1);
}

// ---------------------------------------------------------------- GitHub calls

/**
 * Runs gh. GitHub limits how fast content is created ("secondary rate limit"): such a refusal is
 * retried after a pause that doubles each time, up to five times. Any other failure stops the run.
 */
function gh(args: string[], input?: string): string {
	for (let attempt = 0; ; attempt++) {
		const run = Bun.spawnSync(["gh", ...args], {
			stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
			stdout: "pipe",
			stderr: "pipe",
		});
		if (run.exitCode === 0) return run.stdout.toString();
		const error = run.stderr.toString();
		const limited = /secondary rate limit|abuse|HTTP 403|HTTP 429|was submitted too quickly/i.test(
			error,
		);
		if (limited && attempt < 5) {
			const pause = 60_000 * 2 ** attempt;
			console.error(`GitHub asked to slow down; waiting ${pause / 1000} s`);
			Bun.sleepSync(pause);
			continue;
		}
		console.error(`gh ${args.slice(0, 3).join(" ")} failed:\n${error}`);
		process.exit(1);
	}
}

/** One content-creating call per second keeps well under GitHub's creation limits. */
const pace = () => Bun.sleepSync(1_000);

interface RemoteIssue {
	number: number;
	id: string;
	state: "OPEN" | "CLOSED";
	body: string;
	title: string;
}

function remoteIssues(): Map<string, RemoteIssue> {
	const found = new Map<string, RemoteIssue>();
	const query = `query($cursor: String) { repository(owner: "jahala", name: "conducted") {
		issues(first: 100, after: $cursor, labels: ["backlog"], states: [OPEN, CLOSED]) {
			pageInfo { hasNextPage endCursor }
			nodes { number id state body title } } } }`;
	let cursor: string | null = null;
	for (;;) {
		const args = ["api", "graphql", "-f", `query=${query}`];
		if (cursor) args.push("-f", `cursor=${cursor}`);
		const page = JSON.parse(gh(args)).data.repository.issues;
		for (const issue of page.nodes as RemoteIssue[]) {
			const marker = /<!-- backlog:([A-Z]+-\d{2}|epic:[a-z0-9-]+) -->/.exec(issue.body);
			if (marker?.[1]) found.set(marker[1], issue);
		}
		if (!page.pageInfo.hasNextPage) return found;
		cursor = page.pageInfo.endCursor;
	}
}

/** Keeps what people wrote below the generated marker. */
function merged(generated: string, existing: string | undefined): string {
	if (!existing) return generated;
	const at = existing.indexOf(GENERATED_END);
	return at === -1 ? generated : generated + existing.slice(at + GENERATED_END.length);
}

// ---------------------------------------------------------------- epics

const epics = [...new Set(rows.map((r) => r.epic))];
const epicKey = (epic: string) => `epic:${areaLabel(epic).slice("area:".length)}`;

function renderEpic(epic: string, refs: Map<string, number>): string {
	const members = rows.filter((r) => r.epic === epic);
	const open = members.filter((r) => r.status !== "done").length;
	return [
		`<!-- backlog:${epicKey(epic)} -->`,
		`**Epic: ${epic}**`,
		"",
		`${members.length} features, ${open} open. Each one is a sub-issue of this epic.`,
		"",
		...members.map((r) => `- ${refs.has(r.id) ? `#${refs.get(r.id)} ` : ""}${r.id} ${r.title}`),
		"",
		"Read first: `docs/architecture.md`, `docs/engineering.md`, and the research for this area in `docs/research/conductor/`.",
		"",
		GENERATED_END,
	].join("\n");
}

// ---------------------------------------------------------------- run

if (check) {
	const remote = remoteIssues();
	const problems: string[] = [];
	for (const row of rows) {
		const issue = remote.get(row.id);
		if (!issue) continue;
		if (row.status === "done" && issue.state === "OPEN")
			problems.push(`${row.id} is done but #${issue.number} is open`);
		if (row.status !== "done" && issue.state === "CLOSED")
			problems.push(`#${issue.number} is closed but ${row.id} is not done`);
	}
	for (const p of problems) console.error(p);
	process.exit(problems.length > 0 ? 1 : 0);
}

if (!apply) {
	mkdirSync(join(draftDir, "epics"), { recursive: true });
	for (const row of rows) {
		writeFileSync(
			join(draftDir, `${row.id}.md`),
			`# ${issueTitle(row)}\n\nLabels: ${["backlog", ...labelsOf(row)].join(", ")}\nMilestone: ${milestoneOf(row)}\n\n${renderIssue(row, items.get(row.id) ?? [], files.get(row.id) ?? [], new Map())}\n`,
		);
	}
	for (const epic of epics) {
		writeFileSync(
			join(draftDir, "epics", `${epicKey(epic).slice(5)}.md`),
			renderEpic(epic, new Map()),
		);
	}
	const withItems = rows.filter((r) => (items.get(r.id) ?? []).length > 0).length;
	const withFiles = rows.filter((r) => (files.get(r.id) ?? []).length > 0).length;
	const itemCount = [...items.values()].reduce((n, list) => n + list.length, 0);
	console.log(
		`Dry run: ${epics.length} epics, ${rows.length} feature issues, ${itemCount} checklist items.`,
	);
	console.log(`${withItems} issues have items, ${withFiles} have owning files.`);
	console.log(`Drafts written to ${relative(root, draftDir)}/. Nothing was sent to GitHub.`);
	process.exit(0);
}

// --apply
const labels = new Set(["backlog", "needs-spike", ...rows.flatMap(labelsOf)]);
const existingLabels = new Set(
	JSON.parse(gh(["label", "list", "--repo", repo, "--limit", "500", "--json", "name"])).map(
		(l: { name: string }) => l.name,
	),
);
for (const label of labels) {
	if (!existingLabels.has(label))
		gh([
			"label",
			"create",
			label,
			"--repo",
			repo,
			"--color",
			label.startsWith("priority:1") ? "d93f0b" : "c5def5",
		]);
}

const milestones = new Map<string, number>();
for (const m of JSON.parse(gh(["api", `repos/${repo}/milestones?state=all&per_page=100`])))
	milestones.set(m.title, m.number);
for (const title of new Set(rows.map(milestoneOf))) {
	if (!milestones.has(title)) {
		const created = JSON.parse(gh(["api", `repos/${repo}/milestones`, "-f", `title=${title}`]));
		milestones.set(title, created.number);
	}
}

const remote = remoteIssues();
const refs = new Map<string, number>();
for (const [key, issue] of remote) refs.set(key, issue.number);

function upsert(
	key: string,
	title: string,
	body: string,
	labelList: string[],
	milestone?: string,
): RemoteIssue {
	const existing = remote.get(key);
	const fullBody = merged(body, existing?.body);
	if (existing) {
		if (existing.body !== fullBody || existing.title !== title) {
			gh(
				["api", "-X", "PATCH", `repos/${repo}/issues/${existing.number}`, "--input", "-"],
				JSON.stringify({ title, body: fullBody }),
			);
		}
		return existing;
	}
	const payload: Record<string, unknown> = { title, body: fullBody, labels: labelList };
	if (milestone) payload.milestone = milestones.get(milestone);
	const created = JSON.parse(
		gh(["api", `repos/${repo}/issues`, "--input", "-"], JSON.stringify(payload)),
	);
	const issue = {
		number: created.number,
		id: created.node_id,
		state: "OPEN" as const,
		body: fullBody,
		title,
	};
	remote.set(key, issue);
	refs.set(key, issue.number);
	console.log(`created #${issue.number} ${title}`);
	return issue;
}

// Pass 1 creates everything, so pass 2 can link blockers and epics by number.
for (const row of rows) {
	upsert(
		row.id,
		issueTitle(row),
		renderIssue(row, items.get(row.id) ?? [], files.get(row.id) ?? [], refs),
		["backlog", ...labelsOf(row)],
		milestoneOf(row),
	);
}
for (const epic of epics)
	upsert(epicKey(epic), `Epic: ${epic}`, renderEpic(epic, refs), [
		"backlog",
		"epic",
		areaLabel(epic),
	]);

// Pass 2: refresh bodies with issue numbers, then link sub-issues and blockers.
const linked = (query: string) => {
	if (query.startsWith("mutation")) pace();
	return JSON.parse(gh(["api", "graphql", "-f", `query=${query}`]));
};
for (const row of rows) {
	const issue = remote.get(row.id);
	const epic = remote.get(epicKey(row.epic));
	if (!issue || !epic) continue;
	upsert(
		row.id,
		issueTitle(row),
		renderIssue(row, items.get(row.id) ?? [], files.get(row.id) ?? [], refs),
		[],
	);
	const state = linked(
		`{ node(id: "${issue.id}") { ... on Issue { parent { id } blockedBy(first: 50) { nodes { id } } } } }`,
	).data.node;
	if (!state.parent)
		linked(
			`mutation { addSubIssue(input: { issueId: "${epic.id}", subIssueId: "${issue.id}" }) { issue { id } } }`,
		);
	const blockers = new Set((state.blockedBy?.nodes ?? []).map((n: { id: string }) => n.id));
	for (const need of row.needs) {
		const blocker = remote.get(need);
		if (blocker && !blockers.has(blocker.id)) {
			linked(
				`mutation { addBlockedBy(input: { issueId: "${issue.id}", blockingIssueId: "${blocker.id}" }) { issue { id } } }`,
			);
		}
	}
}
for (const epic of epics) upsert(epicKey(epic), `Epic: ${epic}`, renderEpic(epic, refs), []);
console.log(`Synced ${rows.length} feature issues and ${epics.length} epics.`);

export type { BacklogRow };
