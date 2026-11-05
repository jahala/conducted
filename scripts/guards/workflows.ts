/**
 * Guard: every job in .github/workflows has a `timeout-minutes`, so a hung runner stops at a
 * known time instead of GitHub's default of six hours.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Problem, read } from "./lib.ts";

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

export function checkWorkflows(root: string): Problem[] {
	if (!existsSync(join(root, DIR))) return [];
	return readdirSync(join(root, DIR))
		.filter((name) => /\.ya?ml$/.test(name))
		.flatMap((name) =>
			jobsWithoutTimeout(read(join(root, DIR, name))).map((job) => ({
				guard: "workflows",
				message: `${DIR}/${name}: job ${job} has no timeout-minutes`,
			})),
		);
}
