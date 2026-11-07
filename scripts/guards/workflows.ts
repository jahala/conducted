/**
 * Guards over the workflows and shell scripts that run in CI:
 *  - every job in .github/workflows has a `timeout-minutes`, so a hung runner stops at a known
 *    time instead of GitHub's default of six hours;
 *  - (`workflow-tools`, a separate guard, since it runs programs) actionlint accepts every workflow,
 *    including the shell inside its `run:` steps, and shellcheck accepts every shell script under
 *    bin/ and scripts/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { type Problem, read, walk } from "./lib.ts";

const DIR = ".github/workflows";

/** Names of the jobs in a workflow file that have no timeout. */
export function jobsWithoutTimeout(workflow: string): string[] {
	const lines = workflow.split("\n");
	const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
	if (start === -1) return [];
	const jobs: { name: string; hasTimeout: boolean }[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\S/.test(line)) break;
		const job = /^ {2}([\w-]+):\s*$/.exec(line);
		if (job?.[1]) jobs.push({ name: job[1], hasTimeout: false });
		else if (/^ {4}timeout-minutes:\s*\d+/.test(line) && jobs.length > 0) {
			const last = jobs[jobs.length - 1];
			if (last) last.hasTimeout = true;
		}
	}
	return jobs.filter((job) => !job.hasTimeout).map((job) => job.name);
}

function workflowFiles(root: string): string[] {
	const dir = join(root, DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort()
		.map((name) => `${DIR}/${name}`);
}

/** A tool's findings, or one problem when the tool is not installed or gave no readable line. */
function toolOutput(
	program: string,
	args: readonly string[],
	root: string,
): { error: Problem | null; lines: string[] } {
	const result = spawnSync(program, [...args], { cwd: root, encoding: "utf8" });
	if (result.error !== undefined) {
		return {
			error: {
				guard: "workflow-tools",
				message: `${program} is not installed; pnpm guards needs it`,
			},
			lines: [],
		};
	}
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
	const lines = output
		.split("\n")
		.filter((line) => /:\d+:\d+: /.test(line))
		.map((line) => line.trim());
	if (result.status !== 0 && lines.length === 0 && output !== "") {
		return { error: null, lines: [output] };
	}
	return { error: null, lines };
}

/** Problems actionlint reports across every workflow. */
export function actionlintProblems(root: string): Problem[] {
	const files = workflowFiles(root);
	if (files.length === 0) return [];
	const { error, lines } = toolOutput("actionlint", ["-no-color", ...files], root);
	if (error !== null) return [error];
	return lines.map((message) => ({ guard: "workflow-tools", message }));
}

/** Problems shellcheck reports across bin/ and scripts/. */
export function shellcheckProblems(root: string): Problem[] {
	const files = [
		...walk(root, join(root, "bin"), /\.sh$/),
		...walk(root, join(root, "scripts"), /\.sh$/),
	]
		.map((path) => relative(root, path))
		.sort();
	if (files.length === 0) return [];
	const { error, lines } = toolOutput("shellcheck", ["--format=gcc", ...files], root);
	if (error !== null) return [error];
	return lines.map((message) => ({ guard: "workflow-tools", message }));
}

export function checkWorkflows(root: string): Problem[] {
	return [
		...workflowFiles(root).flatMap((file) =>
			jobsWithoutTimeout(read(join(root, file))).map((job) => ({
				guard: "workflows",
				message: `${file}: job ${job} has no timeout-minutes`,
			})),
		),
	];
}

/** The tool checks, kept apart from `checkWorkflows` so that one stays a read of the files. */
export function checkWorkflowTools(root: string): Problem[] {
	return [...actionlintProblems(root), ...shellcheckProblems(root)];
}
