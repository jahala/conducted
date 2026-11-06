/**
 * Runs the parity checks that read data (a, b, c and e) over a dump, adds the flow results when
 * given, and writes `report.json` and `report.md`. The exit code follows the mode: `report` fails only
 * on broken findings; `enforce` also fails on any gap.
 * Behaviour: docs/plans/parity-harness.md sections 3 and 5. The mode comes from `--mode`, else the
 * workflow's `PARITY_MODE`, else `report`.
 * Must handle: no dump (`--no-dump`) runs checks a and e only and says so in the report; a flows file
 * that is missing when asked for is a broken finding, never a silent pass.
 *
 * Usage: bun scripts/parity/check.ts (<dump.json> | --no-dump) [--flows <flows.json>] [--out <dir>]
 *   [--mode report|enforce]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type Check,
	checkBackend,
	checkCompleteness,
	checkLayout,
	checkText,
	type Finding,
	type Inputs,
} from "./checks.ts";
import type { LayoutSpec } from "./dump.ts";
import {
	DATA,
	type Dump,
	decisionIds,
	type OursOnly,
	ROOT,
	readJson,
	readMaps,
	readSpec,
	strayMapFiles,
} from "./lib.ts";
import { ourNames } from "./ours.ts";
import { countInventories, type Report, renderReport } from "./report.ts";
import { researchScreens } from "./screens.ts";

interface Options {
	dump: string | null;
	flows: string | null;
	out: string;
	mode: Report["mode"];
}

export function parseArgs(argv: string[], env: Record<string, string | undefined>): Options {
	const fromEnv = env.PARITY_MODE;
	const options: Options = {
		dump: null,
		flows: null,
		out: join(ROOT, ".context/parity"),
		mode: fromEnv === "enforce" ? "enforce" : "report",
	};
	let sawDump = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value.`);
			return next;
		};
		if (arg === "--flows") options.flows = resolve(value());
		else if (arg === "--out") options.out = resolve(value());
		else if (arg === "--mode") {
			const mode = value();
			if (mode !== "report" && mode !== "enforce") throw new Error(`Unknown mode ${mode}.`);
			options.mode = mode;
		} else if (arg === "--no-dump") sawDump = true;
		else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
		else {
			options.dump = resolve(arg);
			sawDump = true;
		}
	}
	if (!sawDump) throw new Error("Give a dump.json, or --no-dump to run checks a and e only.");
	return options;
}

export interface FlowResult {
	id: string;
	title: string;
	source: string;
	steps: { step: string; ok: boolean; detail?: string }[];
}

export function flowFindings(results: FlowResult[]): Finding[] {
	return results.flatMap((flow) =>
		flow.steps
			.filter((step) => !step.ok)
			.map((step) => ({
				check: "d" as Check,
				severity: "gap" as const,
				code: "flow-step",
				screen: `Flow: ${flow.title}`,
				id: flow.id,
				text: step.step,
				detail: `${step.detail ?? "the step's visible result is not there"} (${flow.source})`,
			})),
	);
}

function main(options: Options): number {
	const specs = readSpec();
	const maps = readMaps();
	const dump = options.dump === null ? null : readJson<Dump>(options.dump);
	const states = dump === null ? null : new Set(dump.states.map((state) => state.id));
	const inputs: Inputs = {
		specs,
		maps,
		decisions: decisionIds(readFileSync(join(ROOT, "docs/decisions.md"), "utf8")),
		states,
		oursOnly: readJson<OursOnly[]>(join(DATA, "ours-only.json")),
		strayMaps: strayMapFiles(),
		screenFor: researchScreens(ROOT),
	};
	const findings: Finding[] = [...checkCompleteness(inputs)];
	if (dump !== null) {
		findings.push(...checkText(inputs, dump));
		findings.push(...checkLayout(readJson<LayoutSpec>(join(DATA, "layout.json")), dump));
	}
	if (options.flows !== null) {
		if (existsSync(options.flows))
			findings.push(...flowFindings(readJson<FlowResult[]>(options.flows)));
		else {
			findings.push({
				check: "d",
				severity: "broken",
				code: "flows-missing",
				screen: "Harness",
				detail: `${options.flows} does not exist: the flow run did not finish`,
			});
		}
	}
	findings.push(...checkBackend(inputs, ourNames(ROOT)));

	const report: Report = {
		commit: dump?.commit ?? "HEAD (no dump: checks a and e only)",
		mode: options.mode,
		counts: countInventories(specs, maps),
		findings,
	};
	mkdirSync(options.out, { recursive: true });
	writeFileSync(join(options.out, "report.json"), `${JSON.stringify(report, null, "\t")}\n`);
	writeFileSync(join(options.out, "report.md"), renderReport(report));
	const gaps = findings.filter((finding) => finding.severity === "gap").length;
	const broken = findings.filter((finding) => finding.severity === "broken").length;
	console.log(`${gaps} gaps, ${broken} broken. Report: ${join(options.out, "report.md")}`);
	if (broken > 0) return 1;
	return options.mode === "enforce" && gaps > 0 ? 1 : 0;
}

if (import.meta.main) {
	try {
		process.exit(main(parseArgs(process.argv.slice(2), process.env)));
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : cause);
		process.exit(1);
	}
}
