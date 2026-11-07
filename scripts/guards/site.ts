/**
 * Guard: the product page (issue #356) builds, and every link in it leads somewhere. It builds the
 * site in memory from this checkout (scripts/site/inputs.ts, with no release, since release links
 * point at GitHub), then checks every local link, image, stylesheet, font and anchor in the built
 * pages, flags images no page uses, and checks that each link to this repository's files on GitHub
 * names a path that exists, and each link to a heading of the repository's front page
 * (`https://github.com/jahala/conducted#heading`) names a heading README.md has. The README's own
 * links are checked by the docs guard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSiteInput } from "../site/inputs.ts";
import { buildSite, siteLinkProblems } from "../site/site.ts";
import { headingAnchors, repoUrlPath } from "./docs.ts";
import type { Problem } from "./lib.ts";

export function checkSite(root: string): Problem[] {
	const problem = (message: string): Problem => ({ guard: "site", message });
	const read = readSiteInput(root, null);
	if (!read.ok) return read.errors.map(problem);
	const built = buildSite(read.input);
	if (!built.ok) return built.errors.map(problem);
	const { problems, external } = siteLinkProblems(built.files);
	const missingInRepo = external
		.map(repoUrlPath)
		.filter((path): path is string => path !== null && !existsSync(join(root, path)))
		.map((path) => `the site links to ${path} on GitHub, which does not exist`);
	const readme = join(root, "README.md");
	const anchors = existsSync(readme) ? headingAnchors(readFileSync(readme, "utf8")) : new Set();
	const missingHeadings = external
		.map((link) => /^https:\/\/github\.com\/jahala\/conducted\/?#(.+)$/.exec(link)?.[1])
		.filter((anchor): anchor is string => anchor !== undefined && !anchors.has(anchor))
		.map((anchor) => `the site links to README.md#${anchor}, which has no such heading`);
	return [...problems, ...missingInRepo, ...missingHeadings].map(problem);
}
