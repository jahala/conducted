/**
 * Guard: our docs name only paths that exist, and the agent brief stays short.
 * Checks markdown links and backticked repo paths in CLAUDE.md, README.md, CONTRIBUTING.md,
 * docs/*.md and docs/plans/*.md. The research notes describe another app's files and are skipped.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Problem, read } from "./lib.ts";

export const BRIEF = "CLAUDE.md";
export const BRIEF_MAX_LINES = 150;
const ROOT_DOCS = ["CLAUDE.md", "README.md", "CONTRIBUTING.md", "SECURITY.md"];
const DOC_DIRS = ["docs", "docs/plans"];
/** A backticked token that starts like a path in this repo. */
const REPO_PATH = /^(apps|packages|scripts|bin|docs|\.github)\/[\w./-]+$/;

export function docFiles(root: string): string[] {
	const files = ROOT_DOCS.filter((name) => existsSync(join(root, name)));
	for (const dir of DOC_DIRS) {
		if (!existsSync(join(root, dir))) continue;
		for (const name of readdirSync(join(root, dir))) {
			if (name.endsWith(".md")) files.push(`${dir}/${name}`);
		}
	}
	return files;
}

/** Paths a doc refers to, resolved from the repo root. */
export function referencedPaths(doc: string, docPath: string): string[] {
	const paths: string[] = [];
	for (const [, target] of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
		if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
		paths.push(join(dirname(docPath), target.split("#")[0] ?? ""));
	}
	for (const [, token] of doc.matchAll(/`([^`\s]+)`/g)) {
		if (!token || !REPO_PATH.test(token) || /[*<>{}]/.test(token)) continue;
		paths.push(token.replace(/[.,:;]$/, ""));
	}
	return paths;
}

export function checkDocs(root: string): Problem[] {
	const problems: Problem[] = [];
	for (const file of docFiles(root)) {
		const text = read(join(root, file));
		for (const path of new Set(referencedPaths(text, file))) {
			if (!existsSync(join(root, path))) {
				problems.push({ guard: "docs", message: `${file} names ${path}, which does not exist` });
			}
		}
	}
	const briefPath = join(root, BRIEF);
	if (existsSync(briefPath)) {
		const lines = read(briefPath).split("\n").length;
		if (lines > BRIEF_MAX_LINES) {
			problems.push({
				guard: "docs",
				message: `${BRIEF} has ${lines} lines; keep it under ${BRIEF_MAX_LINES}`,
			});
		}
	}
	return problems;
}
