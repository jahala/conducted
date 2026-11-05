/**
 * Pure parts of the issue sync: read the backlog, the item map and the file headers, and render
 * each GitHub issue. The plan is docs/plans/github-issues.md. Nothing here touches the network.
 */

export interface BacklogRow {
	id: string;
	title: string;
	owner: string;
	research: string;
	priority: 1 | 2 | 3;
	status: "stub" | "done" | "planned";
	needs: string[];
	/** The backlog section the row sits in; one epic per section. */
	epic: string;
}

export interface Item {
	id: string;
	kind: string;
	item: string;
	research: string;
	status: string;
}

export interface OwningFile {
	path: string;
	owns: string | null;
	testFirst: string | null;
}

const ID = /^[A-Z]+-\d{2}$/;

/** Splits a Markdown table row into trimmed cells. */
function cells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

export interface BacklogScan {
	rows: BacklogRow[];
	/** Rows that look like features but cannot be read: a bad status or a bad priority. */
	problems: string[];
}

/** Reads the backlog and reports every row it cannot read, so no feature drops out unseen. */
export function scanBacklog(text: string): BacklogScan {
	const rows: BacklogRow[] = [];
	const problems: string[] = [];
	let epic = "";
	let header: string[] = [];
	for (const line of text.split("\n")) {
		const section = /^## (.+)$/.exec(line);
		if (section?.[1]) {
			epic = section[1].replace(/\s*\([A-Z, ]+\)\s*$/, "").replace(/^Planned:\s*/, "");
			header = [];
			continue;
		}
		if (!line.startsWith("|")) continue;
		const row = cells(line);
		if (row[0] === "ID") {
			header = row.map((name) => name.toLowerCase());
			continue;
		}
		if (!row[0] || !ID.test(row[0]) || header.length === 0) continue;
		const get = (name: string) => row[header.indexOf(name)] ?? "";
		const status = get("status");
		if (status !== "stub" && status !== "done" && status !== "planned") {
			problems.push(`${row[0]} has status "${status}"; use stub, done or planned`);
			continue;
		}
		const priority = Number(get("p"));
		if (priority !== 1 && priority !== 2 && priority !== 3) {
			problems.push(`${row[0]} has priority "${get("p")}"; use 1, 2 or 3`);
			continue;
		}
		const needs = get("needs")
			.split(/[,\s]+/)
			.filter(Boolean);
		for (const need of needs.filter((n) => !ID.test(n))) {
			problems.push(`${row[0]} needs "${need}", which is not a feature id`);
		}
		rows.push({
			id: row[0],
			title: get("feature"),
			owner: get("owner"),
			research: get("research"),
			priority,
			status,
			needs: needs.filter((need) => ID.test(need)),
			epic,
		});
	}
	return { rows, problems };
}

/** The rows of the backlog. A row it cannot read stops the script that asked, with the reason. */
export function parseBacklog(text: string): BacklogRow[] {
	const { rows, problems } = scanBacklog(text);
	if (problems.length > 0) throw new Error(`docs/plans/backlog.md: ${problems.join("; ")}`);
	return rows;
}

export function parseItems(tsv: string): Item[] {
	const [head, ...lines] = tsv.split("\n").filter((line) => line.trim() !== "");
	if (!head) return [];
	const columns = head.split("\t").map((c) => c.trim().toLowerCase());
	return lines.map((line) => {
		const values = line.split("\t");
		const get = (name: string) => (values[columns.indexOf(name)] ?? "").trim();
		return {
			id: get("id"),
			kind: get("kind"),
			item: get("item"),
			research: get("research"),
			status: get("status"),
		};
	});
}

/** Reads `@feature`, `Owns:` and `Test first:` from a file's header comment. */
export function parseHeader(path: string, text: string): { ids: string[]; file: OwningFile } {
	const head = text.slice(0, 4000);
	const ids = [...head.matchAll(/@feature\s+([A-Z]+-\d{2})/g)].map((m) => m[1] ?? "");
	const field = (name: string) => {
		const match = new RegExp(`${name}:\\s*([^\\n]*(?:\\n\\s*(?:\\*|//!|#)\\s{2,}[^\\n]*)*)`).exec(
			head,
		);
		return match?.[1] ? match[1].replace(/\n\s*(?:\*|\/\/!|#)\s*/g, " ").trim() : null;
	};
	return { ids, file: { path, owns: field("Owns"), testFirst: field("Test first") } };
}

export const LAYERS: [RegExp, string][] = [
	[/^R\/|src-tauri/, "rust"],
	[/^S\/|^bin|packages\/sidecar/, "sidecar"],
	[/^D\/core|^D\/platform/, "core"],
	[/^D\/|apps\/desktop/, "ui"],
	[/apps\/cloud/, "cloud"],
];

export function layersOf(owner: string): string[] {
	const parts = owner.split(/,\s*/);
	const layers = new Set<string>();
	for (const part of parts) {
		const hit = LAYERS.find(([pattern]) => pattern.test(part));
		if (hit) layers.add(hit[1]);
	}
	return [...layers];
}

export function areaLabel(epic: string): string {
	return `area:${epic
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")}`;
}

export function milestoneOf(row: BacklogRow): string {
	if (row.id.startsWith("CLOUD-")) return "Cloud";
	if (row.id.startsWith("RC-")) return "Remote Control";
	return row.priority === 1 ? "First slice" : row.priority === 2 ? "Daily use" : "Polish";
}

export function labelsOf(row: BacklogRow): string[] {
	const labels = [
		areaLabel(row.epic),
		`priority:${row.priority}`,
		...layersOf(row.owner).map((l) => `layer:${l}`),
	];
	if (row.status === "planned") labels.push("needs-spike");
	return labels;
}

export const MARKER = (id: string) => `<!-- backlog:${id} -->`;
export const GENERATED_END =
	"<!-- generated above this line from docs/plans/backlog.md, docs/plans/items and file headers: edit those, not this text -->";

export function issueTitle(row: BacklogRow): string {
	return `${row.id} ${row.title}`;
}

export function renderIssue(
	row: BacklogRow,
	items: Item[],
	files: OwningFile[],
	refs: Map<string, number>,
): string {
	const ref = (id: string) => (refs.has(id) ? `#${refs.get(id)} ${id}` : id);
	const lines = [
		MARKER(row.id),
		`**${row.id} ${row.title}**`,
		"",
		`Area: ${row.epic} · Priority ${row.priority} · Milestone: ${milestoneOf(row)}`,
		`Research: \`docs/research/conductor/\` ${row.research}`,
		`Owner folder: \`${row.owner}\``,
	];
	if (row.needs.length > 0) lines.push(`Blocked by: ${row.needs.map(ref).join(", ")}`);
	if (row.status === "planned") {
		lines.push("", "Planned: waits for its spike in `docs/plans/cloud-and-remote.md`.");
	}
	if (files.length > 0) {
		lines.push("", "### Owning files", "");
		for (const file of files) {
			lines.push(`- \`${file.path}\`${file.owns ? `: ${file.owns}` : ""}`);
			if (file.testFirst) lines.push(`  - Test first: ${file.testFirst}`);
		}
	}
	if (items.length > 0) {
		lines.push("", `### Everything this feature covers (${items.length})`, "");
		const byKind = new Map<string, Item[]>();
		for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
		for (const [kind, group] of [...byKind].sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(`**${kind}**`, "");
			for (const item of group) {
				const note =
					item.status && item.status !== "covered" ? ` _(scaffold: ${item.status})_` : "";
				lines.push(`- [ ] ${item.item}${note}${item.research ? ` · ${item.research}` : ""}`);
			}
			lines.push("");
		}
	}
	lines.push(
		"### Done when",
		"",
		`- [ ] The placeholders for ${row.id} are gone, and every item above works and has a test.`,
		`- [ ] The backlog row for ${row.id} is set to \`done\` in the PR that closes this issue.`,
		"",
		GENERATED_END,
	);
	return lines.join("\n");
}

/** True when GitHub refused a call for going too fast, so waiting and retrying can help. */
export const isRateLimited = (error: string): boolean =>
	/rate limit|abuse|HTTP 429|was submitted too quickly/i.test(error);

export type OnlyArg = { only: Set<string> | null } | { error: string };

/**
 * Reads `--only A-01,B-02`. No flag means every row. A flag with no value, or with something
 * that is not a feature id, is an error, so a typo never widens a run to every issue.
 */
export function parseOnly(argv: string[]): OnlyArg {
	const at = argv.indexOf("--only");
	if (at === -1) return { only: null };
	const value = argv[at + 1];
	if (value === undefined || value.startsWith("--")) {
		return { error: "--only needs a comma-separated list of feature ids, for example A-01,B-02" };
	}
	const ids = value.split(",");
	const bad = ids.filter((id) => !ID.test(id));
	if (bad.length > 0)
		return { error: `--only has values that are not feature ids: ${bad.join(", ")}` };
	return { only: new Set(ids) };
}
