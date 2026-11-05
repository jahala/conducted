/**
 * @feature SIDE-09 Prompt assembly: pull-request stub file
 * Owns: the markdown stub a pull-request mention links to, and writing it into the workspace.
 * Behaviour: research/conductor/sessions.md section 9 and claude-runner.md section 5 item 4: a
 * pull-request mention becomes a link to `.context/pull-requests/<n>.md`; the stub is written once
 * and never overwritten, because the agent may add notes to it.
 * Must handle: a stub that already exists (kept), a missing repository name (heading only), and a
 * failed write (returned as a Result for the caller to log).
 * Test first: a stub has a heading and, when the repository is known, its GitHub URL.
 * Our design choice: this is the file-system edge. The assembler takes the writer as a port, so it
 * stays free of hidden I/O.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppError, Result } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { pullRequestStubPath } from "./mentions.ts";

/** The small markdown stub a pull-request mention links to. */
export function buildPullRequestStub(number: number, repositoryFullName?: string): string {
	const lines = [`# Pull request #${number}`];
	if (repositoryFullName !== undefined && repositoryFullName.trim() !== "") {
		lines.push("", `GitHub URL: https://github.com/${repositoryFullName.trim()}/pull/${number}`);
	}
	return `${lines.join("\n")}\n`;
}

/** Writes a pull-request stub with a create-only open, so an existing file is never replaced. */
export async function writePullRequestStubFile(
	workspacePath: string,
	number: number,
	repositoryFullName?: string,
): Promise<Result<void, AppError>> {
	const relative = pullRequestStubPath(number);
	const target = join(workspacePath, relative);
	try {
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, buildPullRequestStub(number, repositoryFullName), {
			encoding: "utf8",
			flag: "wx",
		});
		return ok(undefined);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "EEXIST") return ok(undefined);
		return err(
			appError(
				"PROMPT_PR_STUB_WRITE_FAILED",
				`Could not write the pull-request stub ${relative}.`,
				cause,
			),
		);
	}
}
