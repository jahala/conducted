/**
 * Builds the product page into a folder (issue #356): reads docs/site, the app's fonts and
 * CHANGELOG.md (scripts/site/inputs.ts), asks GitHub for the latest release, builds the site
 * (scripts/site/site.ts), checks its links, and writes it. The Pages workflow
 * (.github/workflows/pages.yml) runs it and publishes the folder.
 *
 * Usage: bun scripts/site/build.ts <out-dir>
 * The folder must be new or empty, so a run never mixes with an older build. Any failure (a release
 * lookup GitHub refuses, a template without its marker, a broken link) stops the run with exit 1.
 * Set GITHUB_TOKEN to make the release lookup with the workflow's token.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readSiteInput } from "./inputs.ts";
import { buildSite, type LatestRelease, siteLinkProblems } from "./site.ts";

const ROOT = resolve(import.meta.dir, "../..");
const LATEST_RELEASE = "https://api.github.com/repos/jahala/conducted/releases/latest";

interface ReleaseAnswer {
	tag_name: string;
	html_url: string;
	assets: { name: string; browser_download_url: string }[];
}

/** The latest published release and its `.dmg`, or null when the repository has no release. */
async function latestRelease(token: string | undefined): Promise<LatestRelease | null> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
	const response = await fetch(LATEST_RELEASE, { headers });
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`GitHub answered ${response.status} for the latest release`);
	}
	const release = (await response.json()) as ReleaseAnswer;
	const dmg = release.assets.find((asset) => asset.name.endsWith(".dmg"));
	return {
		tag: release.tag_name,
		url: release.html_url,
		dmg: dmg === undefined ? null : { name: dmg.name, url: dmg.browser_download_url },
	};
}

async function main(): Promise<number> {
	const out = process.argv[2];
	if (out === undefined) {
		console.error("Usage: bun scripts/site/build.ts <out-dir>");
		return 1;
	}
	if (existsSync(out) && readdirSync(out).length > 0) {
		console.error(`${out} is not empty; give a new or empty folder`);
		return 1;
	}
	let latest: LatestRelease | null;
	try {
		latest = await latestRelease(process.env.GITHUB_TOKEN);
	} catch (error) {
		console.error(`Could not read the latest release: ${String(error)}`);
		return 1;
	}
	const read = readSiteInput(ROOT, latest);
	if (!read.ok) {
		for (const error of read.errors) console.error(error);
		return 1;
	}
	const built = buildSite(read.input);
	if (!built.ok) {
		for (const error of built.errors) console.error(error);
		return 1;
	}
	const { problems } = siteLinkProblems(built.files);
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		return 1;
	}
	for (const [path, content] of built.files) {
		const target = join(out, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	const download = latest?.dmg ? latest.dmg.name : "none published yet";
	console.log(`Built ${built.files.size} files into ${out}. Download: ${download}.`);
	return 0;
}

process.exit(await main());
