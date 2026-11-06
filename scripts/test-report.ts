/**
 * Lists every failed test of a CI run, grouped by file, from the JUnit reports the test runners
 * write when `CONDUCTED_TEST_REPORTS` names a folder (Vitest in the desktop, `bun test` in the
 * packages and in scripts/). `pnpm -r` interleaves the runners' output and GitHub shows only the
 * first ten annotations of a step, so this list is the one place that names every failure.
 *
 * - Each runner is named with the folder its report's paths start from: `desktop=apps/desktop`.
 * - A report that is missing or cannot be read is a problem, never "no failures": the runner may
 *   have crashed before it wrote one.
 * - A report whose totals count more failures than its test cases name says how many it did not
 *   name, so a failure outside any test (a file that fails to load) is not lost.
 * - The list goes to stdout and, when `GITHUB_STEP_SUMMARY` is set, to the run's summary page.
 *
 * Usage: bun scripts/test-report.ts <folder> <runner>=<path>...
 * Exits 1 when a report is missing or unreadable or names a failure, else 0.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export interface FailedTest {
	/** Path from the repository root. */
	file: string;
	/** Describe titles and the test title, joined with " > ". */
	title: string;
	/** The first line of the failure message. */
	message: string;
}

/** What one report says: the failed tests, the test count and any failures it did not name. */
export interface JUnitRead {
	tests: number;
	failed: FailedTest[];
	/** Failures the report's totals count but no test case names. */
	unnamed: number;
}

export type RunnerResult = ({ runner: string } & JUnitRead) | { runner: string; problem: string };

const MESSAGE_LIMIT = 300;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

const unescapeXml = (text: string): string =>
	text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
		if (name.startsWith("#x") || name.startsWith("#X"))
			return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
		if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
		return ENTITIES[name] ?? whole;
	});

const attributesOf = (text: string): Record<string, string> => {
	const attributes: Record<string, string> = {};
	for (const match of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
		attributes[match[1] ?? ""] = unescapeXml(match[2] ?? "");
	}
	return attributes;
};

const firstLine = (text: string): string => {
	const line =
		text
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part !== "") ?? "";
	return line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT)}...` : line;
};

/** Joins a report path to the runner's folder, so every file reads as a path from the root. */
const fromRoot = (folder: string, file: string, root: string): string => {
	if (isAbsolute(file)) return relative(root, file);
	return folder === "." || folder === "" ? file : join(folder, file);
};

const SOURCE_FILE = /\.(c|m)?[jt]sx?$/;

interface Element {
	name: string;
	attributes: Record<string, string>;
}

interface OpenCase {
	attributes: Record<string, string>;
	suites: Element[];
	failure: string | null;
	text: string;
}

/**
 * Reads one JUnit report. `folder` is where the runner's paths start, from the repository root
 * `root`. Throws when the text is not a JUnit report, so the caller can say which file it was.
 */
export function readJUnit(xml: string, folder: string, root: string): JUnitRead {
	const token =
		/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
	const stack: Element[] = [];
	const failed: FailedTest[] = [];
	let tests = 0;
	let rootTotal: number | null = null;
	let open: OpenCase | null = null;
	let sawSuites = false;

	const fileOf = (attributes: Record<string, string>, suites: Element[]): string => {
		const named =
			attributes.file ??
			[...suites].reverse().find((suite) => suite.attributes.file !== undefined)?.attributes.file ??
			(SOURCE_FILE.test(attributes.classname ?? "") ? attributes.classname : undefined) ??
			suites[0]?.attributes.name ??
			"(unknown file)";
		return fromRoot(folder, named, root);
	};

	const titleOf = (attributes: Record<string, string>, suites: Element[]): string => {
		const file = suites[0]?.attributes.name;
		const describes = suites
			.slice(1)
			.map((suite) => suite.attributes.name ?? "")
			.filter((name) => name !== "" && name !== file && name !== attributes.file);
		return [...describes, attributes.name ?? "(unnamed test)"].join(" > ");
	};

	for (const match of xml.matchAll(token)) {
		const [, cdata, closing, tag, rawAttributes, selfClosing, text] = match;
		const content = cdata ?? text;
		if (content !== undefined) {
			const inside = stack.at(-1)?.name;
			if (open !== null && (inside === "failure" || inside === "error")) {
				open.text += cdata ?? unescapeXml(content);
			}
			continue;
		}
		if (tag === undefined) continue;
		const attributes = attributesOf(rawAttributes ?? "");
		if (closing === "/") {
			if (tag === "testcase" && open !== null) {
				if (open.failure !== null) {
					failed.push({
						file: fileOf(open.attributes, open.suites),
						title: titleOf(open.attributes, open.suites),
						message: firstLine(open.failure || open.text),
					});
				}
				open = null;
			}
			if (stack.at(-1)?.name === tag) stack.pop();
			continue;
		}
		if (tag === "testsuites") {
			sawSuites = true;
			if (attributes.failures !== undefined || attributes.errors !== undefined) {
				rootTotal = Number(attributes.failures ?? 0) + Number(attributes.errors ?? 0);
				if (!Number.isInteger(rootTotal)) {
					throw new Error(`its totals are not counts (failures="${attributes.failures}")`);
				}
			}
		}
		if (tag === "testsuite") sawSuites = true;
		if (tag === "testcase") {
			tests += 1;
			open = {
				attributes,
				suites: stack.filter((element) => element.name === "testsuite"),
				failure: null,
				text: "",
			};
			if (selfClosing === "/") open = null;
		} else if ((tag === "failure" || tag === "error") && open !== null) {
			open.failure = open.failure ?? attributes.message ?? "";
		} else if (tag === "failure" || tag === "error") {
			const suites = stack.filter((element) => element.name === "testsuite");
			failed.push({
				file: fileOf({}, suites),
				title: "(outside any test)",
				message: firstLine(attributes.message ?? attributes.type ?? ""),
			});
		}
		if (selfClosing !== "/") stack.push({ name: tag, attributes });
	}

	if (!sawSuites) throw new Error("it holds no <testsuites> or <testsuite> element");
	const unnamed = rootTotal === null ? 0 : Math.max(0, rootTotal - failed.length);
	return { tests, failed, unnamed };
}

/** The summary in Markdown, which also reads well as plain text in the log. */
export function renderSummary(results: RunnerResult[]): string {
	const lines: string[] = [];
	const read = results.filter((result): result is { runner: string } & JUnitRead => {
		return !("problem" in result);
	});
	const failed = read.flatMap((result) => result.failed);
	const unnamed = read.reduce((sum, result) => sum + result.unnamed, 0);
	const tests = read.reduce((sum, result) => sum + result.tests, 0);
	const files = [...new Set(failed.map((test) => test.file))].sort();

	const total = failed.length + unnamed;
	const missing = results.length - read.length;
	const plural = (count: number, word: string): string =>
		`${count} ${word}${count === 1 ? "" : "s"}`;
	if (total === 0 && missing === 0) {
		lines.push(`## Tests: ${tests} ran in ${plural(read.length, "report")}, none failed`);
	} else {
		const where = files.length > 0 ? ` in ${plural(files.length, "file")}` : "";
		const unread = missing > 0 ? `, and ${plural(missing, "report")} missing or unreadable` : "";
		lines.push(`## Tests: ${total} failed${where}${unread}`);
	}
	for (const file of files) {
		lines.push("", `### ${file}`, "");
		for (const test of failed.filter((item) => item.file === file)) {
			lines.push(`- ${test.title}${test.message === "" ? "" : `: ${test.message}`}`);
		}
	}
	for (const result of read.filter((item) => item.unnamed > 0)) {
		lines.push(
			"",
			`The ${result.runner} report counts ${result.unnamed} more failure(s) that no test names; read that runner's log.`,
		);
	}
	for (const result of results) {
		if ("problem" in result)
			lines.push("", `No usable report from ${result.runner}: ${result.problem}`);
	}
	return `${lines.join("\n")}\n`;
}

/** True when the run needs attention: a failure, an unnamed failure or a missing report. */
export const needsAttention = (results: RunnerResult[]): boolean =>
	results.some((result) => "problem" in result || result.failed.length > 0 || result.unnamed > 0);

/** Parses `name=folder` arguments. A bare name or an empty part is an error. */
export function parseRunners(args: string[]): { name: string; folder: string }[] {
	return args.map((arg) => {
		const [name, folder] = arg.split("=");
		if (!name || folder === undefined || folder === "") {
			throw new Error(`"${arg}" is not <runner>=<folder>, for example desktop=apps/desktop`);
		}
		return { name, folder };
	});
}

if (import.meta.main) {
	const [folder, ...args] = process.argv.slice(2);
	if (folder === undefined || args.length === 0) {
		console.error("Usage: bun scripts/test-report.ts <folder> <runner>=<path>...");
		process.exit(64);
	}
	const root = join(import.meta.dir, "..");
	const results: RunnerResult[] = parseRunners(args).map(({ name, folder: from }) => {
		const path = join(folder, `${name}.xml`);
		if (!existsSync(path)) return { runner: name, problem: `${path} was not written` };
		try {
			return { runner: name, ...readJUnit(readFileSync(path, "utf8"), from, root) };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return { runner: name, problem: `${path} cannot be read: ${reason}` };
		}
	});
	const summary = renderSummary(results);
	process.stdout.write(summary);
	const page = process.env.GITHUB_STEP_SUMMARY;
	if (page) appendFileSync(page, summary);
	process.exit(needsAttention(results) ? 1 : 0);
}
