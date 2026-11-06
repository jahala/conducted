/**
 * The parity report: counts per inventory (matched, decided, gaps), the findings of each check, and
 * the gap list grouped by screen, as JSON for tools and Markdown for people.
 * Behaviour: docs/plans/parity-harness.md sections 3 and 5.
 * Must handle: an inventory with no entries still has its row; the same findings always render the
 * same Markdown, in a fixed order, so two reports can be compared with a diff.
 */
import type { Finding } from "./checks.ts";
import type { Inventory, MapFile, SpecFile } from "./lib.ts";

export interface InventoryCount {
	inventory: Inventory;
	entries: number;
	matched: number;
	unsure: number;
	decided: number;
	gaps: number;
}

export interface Report {
	commit: string;
	mode: "report" | "enforce";
	counts: InventoryCount[];
	findings: Finding[];
}

export function countInventories(
	specs: Map<Inventory, SpecFile>,
	maps: Map<Inventory, MapFile>,
): InventoryCount[] {
	return [...specs].map(([inventory, spec]) => {
		const map = maps.get(inventory) ?? {};
		const count: InventoryCount = {
			inventory,
			entries: spec.entries.length,
			matched: 0,
			unsure: 0,
			decided: 0,
			gaps: 0,
		};
		for (const entry of spec.entries) {
			const mapped = map[entry.id];
			if (mapped?.status === "matched") {
				count.matched += 1;
				if (mapped.by === "seed-unsure") count.unsure += 1;
			} else if (mapped?.status === "decided") count.decided += 1;
			else count.gaps += 1;
		}
		return count;
	});
}

const CHECK_NAMES: Record<Finding["check"], string> = {
	a: "a. Map completeness",
	b: "b. Text and controls",
	c: "c. Layout",
	d: "d. Flows",
	e: "e. Backend lists",
};

const cell = (text: string | undefined): string =>
	(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);

export function renderReport(report: Report): string {
	const lines: string[] = [];
	const gaps = report.findings.filter((finding) => finding.severity === "gap");
	const broken = report.findings.filter((finding) => finding.severity === "broken");
	lines.push(`# Parity report for ${report.commit}`, "");
	lines.push(
		`Mode: ${report.mode}. ${gaps.length} gaps, ${broken.length} broken findings. A broken finding means the harness or its data is wrong; it always fails.`,
		"",
	);
	lines.push("## Inventories", "");
	lines.push("| Inventory | Entries | Matched | of them unsure | Decided | Gaps |");
	lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
	const total = { entries: 0, matched: 0, unsure: 0, decided: 0, gaps: 0 };
	for (const count of report.counts) {
		lines.push(
			`| ${count.inventory} | ${count.entries} | ${count.matched} | ${count.unsure} | ${count.decided} | ${count.gaps} |`,
		);
		total.entries += count.entries;
		total.matched += count.matched;
		total.unsure += count.unsure;
		total.decided += count.decided;
		total.gaps += count.gaps;
	}
	lines.push(
		`| Total | ${total.entries} | ${total.matched} | ${total.unsure} | ${total.decided} | ${total.gaps} |`,
		"",
	);
	lines.push("## Findings by check", "");
	lines.push("| Check | Code | Gaps | Broken |", "| --- | --- | ---: | ---: |");
	const byCode = new Map<string, { gap: number; broken: number }>();
	for (const finding of report.findings) {
		const key = `${CHECK_NAMES[finding.check]}|${finding.code}`;
		const tally = byCode.get(key) ?? { gap: 0, broken: 0 };
		tally[finding.severity] += 1;
		byCode.set(key, tally);
	}
	for (const [key, tally] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
		const [check, code] = key.split("|");
		lines.push(`| ${check} | ${code} | ${tally.gap} | ${tally.broken} |`);
	}
	lines.push("");
	if (broken.length > 0) {
		lines.push("## Broken", "");
		for (const finding of broken) lines.push(`- ${findingLine(finding)}`);
		lines.push("");
	}
	lines.push("## Gaps by screen", "");
	const screens = new Map<string, Finding[]>();
	for (const finding of gaps) {
		const list = screens.get(finding.screen) ?? [];
		list.push(finding);
		screens.set(finding.screen, list);
	}
	for (const [screen, list] of [...screens].sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`### ${screen} (${list.length})`, "");
		lines.push("| Check | Code | Where | Text | Detail |", "| --- | --- | --- | --- | --- |");
		for (const finding of list) {
			lines.push(
				`| ${finding.check} | ${finding.code} | ${cell(finding.id ?? finding.state)} | ${cell(finding.text)} | ${cell(finding.detail)} |`,
			);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

function findingLine(finding: Finding): string {
	const where = [finding.inventory, finding.id, finding.state].filter(Boolean).join(" ");
	return `${CHECK_NAMES[finding.check]}, ${finding.code}${where === "" ? "" : ` (${where})`}: ${finding.detail}`;
}
