/**
 * Guard: our docs name only paths that exist, and the agent brief stays short.
 * Checks markdown links, HTML image sources, links to this repository's files on GitHub, and
 * backticked repo paths in
 * CLAUDE.md, README.md, CONTRIBUTING.md, docs/*.md and docs/plans/*.md. The research notes
 * describe another app's files and are skipped. The product page's links are checked by
 * scripts/guards/site.ts.
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
/** A link to a file or folder of this repository on GitHub, as the README and the site write them. */
const REPO_URL_PATH = /^https:\/\/github\.com\/jahala\/conducted\/(?:blob|tree)\/main\/([^#?]+)/;

/** The repository path a GitHub link to this repository names, or null for any other link. */
export function repoUrlPath(url: string): string | null {
	const path = REPO_URL_PATH.exec(url)?.[1];
	return path === undefined ? null : decodeURIComponent(path).replace(/\/$/, "");
}

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
		if (!target) continue;
		const onGitHub = repoUrlPath(target);
		if (onGitHub !== null) paths.push(onGitHub);
		if (/^(https?:|mailto:|#)/.test(target)) continue;
		paths.push(join(dirname(docPath), target.split("#")[0] ?? ""));
	}
	// HTML images in markdown, such as a README's <picture> with a light and a dark screenshot.
	for (const [, attribute, value = ""] of doc.matchAll(/\s(src|srcset)="([^"]+)"/g)) {
		const targets =
			attribute === "srcset" ? value.split(",").map((c) => c.trim().split(/\s+/)[0]) : [value];
		for (const target of targets) {
			if (!target || /^(https?:|data:|#)/.test(target)) continue;
			paths.push(join(dirname(docPath), target));
		}
	}
	for (const [, token] of doc.matchAll(/`([^`\s]+)`/g)) {
		if (!token || !REPO_PATH.test(token) || /[*<>{}]/.test(token)) continue;
		paths.push(token.replace(/[.,:;]$/, ""));
	}
	return paths;
}

/** The anchor GitHub gives a markdown heading: lower case, punctuation dropped, spaces as hyphens. */
export function headingAnchor(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

/** The anchors of every heading in a markdown file. */
export function headingAnchors(markdown: string): Set<string> {
	return new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => headingAnchor(m[1] ?? "")));
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
