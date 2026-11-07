/**
 * The product page is built from its templates, CHANGELOG.md and the latest GitHub release. These
 * tests build it from the same shapes the release script writes (scripts/release/changelog.ts), so
 * a change to the changelog format breaks them here first.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addRelease, releaseSection } from "../release/changelog.ts";
import {
	buildSite,
	type LatestRelease,
	parseChangelog,
	renderDownload,
	type SiteInput,
	siteLinkProblems,
} from "./site.ts";

const CHANGELOG = addRelease(
	addRelease(
		"# Changelog\n\nRelease notes, newest first.\n",
		releaseSection({
			version: "0.2.0",
			date: "2026-11-05",
			commits: ["feat: queue follow-ups (#12)", "fix: keep the <Composer> draft"],
		}),
	),
	releaseSection({
		version: "0.3.0",
		date: "2026-11-09",
		commits: ["fix: `gh` sign-in survives a restart (#40)", "docs: a product page"],
	}),
);

const DMG: LatestRelease = {
	tag: "v0.3.0",
	url: "https://github.com/jahala/conducted/releases/tag/v0.3.0",
	dmg: {
		name: "Conducted_0.3.0_aarch64.dmg",
		url: "https://github.com/jahala/conducted/releases/download/v0.3.0/Conducted_0.3.0_aarch64.dmg",
	},
};

const PAGE = (body: string, css = "style.css") =>
	`<!doctype html><html><head><link rel="stylesheet" href="${css}"></head><body>${body}</body></html>`;

function input(overrides: Partial<SiteInput> = {}): SiteInput {
	return {
		index: PAGE(
			'<img src="images/home.png" alt=""><a href="changelog/#releases">All</a><!-- site:download --><!-- site:recent-releases -->',
		),
		changelogPage: PAGE('<h1 id="releases">Changelog</h1><!-- site:releases -->', "../style.css"),
		css: "@font-face { src: url(fonts/Geist-Variable.woff2); }",
		images: new Map([["home.png", new Uint8Array([1])]]),
		fonts: new Map([["Geist-Variable.woff2", new Uint8Array([2])]]),
		changelog: CHANGELOG,
		latest: null,
		...overrides,
	};
}

test("reads the releases newest first, with an anchor named after the tag", () => {
	const result = parseChangelog(CHANGELOG);
	if (!result.ok) throw new Error(result.error);
	expect(result.value.map((release) => release.version)).toEqual(["0.3.0", "0.2.0"]);
	expect(result.value.map((release) => release.anchor)).toEqual(["v0.3.0", "v0.2.0"]);
	expect(result.value[0]?.date).toBe("2026-11-09");
	expect(result.value[0]?.areas.map((area) => [area.name, area.items.length])).toEqual([
		["Docs", 1],
		["Fixes", 1],
	]);
});

test("refuses a release heading it cannot read, instead of dropping the release", () => {
	const result = parseChangelog("# Changelog\n\n## Next release\n\n- something\n");
	expect(result).toEqual({
		ok: false,
		error: 'CHANGELOG.md: "## Next release" is not a "## X.Y.Z (YYYY-MM-DD)" release heading',
	});
});

test("the Changelog page lists every release with its anchor, its date, and escaped text", () => {
	const result = buildSite(input());
	if (!result.ok) throw new Error(result.errors.join("\n"));
	const page = String(result.files.get("changelog/index.html"));
	expect(page).toContain('id="v0.3.0"');
	expect(page).toContain('id="v0.2.0"');
	expect(page.indexOf('id="v0.3.0"')).toBeLessThan(page.indexOf('id="v0.2.0"'));
	expect(page).toContain("November 9, 2026");
	expect(page).toContain("keep the &lt;Composer&gt; draft");
	expect(page).toContain("<code>gh</code> sign-in survives a restart");
	expect(page).toContain('<a href="https://github.com/jahala/conducted/pull/40">#40</a>');
	expect(page).not.toContain("<!-- site:releases -->");
});

test("the home page shows the newest releases and links each to its anchor", () => {
	const result = buildSite(input());
	if (!result.ok) throw new Error(result.errors.join("\n"));
	const page = String(result.files.get("index.html"));
	expect(page).toContain('href="changelog/#v0.3.0"');
	expect(page).toContain('href="changelog/#v0.2.0"');
	expect(page).toContain('<span class="release-card-count">2 changes</span>');
	expect(page).toContain('<span class="release-card-areas">Docs, Fixes</span>');
	expect(page).not.toContain("<!-- site:recent-releases -->");
});

test("an empty changelog shows a designed empty state on both pages", () => {
	const result = buildSite(input({ changelog: "# Changelog\n\nRelease notes, newest first.\n" }));
	if (!result.ok) throw new Error(result.errors.join("\n"));
	expect(String(result.files.get("changelog/index.html"))).toContain("No releases yet");
	expect(String(result.files.get("index.html"))).toContain("No releases yet");
});

test("download points at the latest release's .dmg when there is one", () => {
	const html = renderDownload(DMG);
	expect(html).toContain(`href="${DMG.dmg?.url}"`);
	expect(html).toContain("v0.3.0");
});

test("download says plainly that no signed build exists yet, and points at building from source", () => {
	const noDmg = renderDownload({ ...DMG, dmg: null });
	const noRelease = renderDownload(null);
	for (const html of [noDmg, noRelease]) {
		expect(html).toContain("No signed build is published yet");
		expect(html).toContain("#build-from-source");
		expect(html).not.toContain(".dmg");
	}
});

test("a template without its marker is an error, not a page with a hole", () => {
	const result = buildSite(input({ changelogPage: PAGE("<h1>Changelog</h1>") }));
	expect(result).toEqual({
		ok: false,
		errors: ["changelog.html has no <!-- site:releases --> marker"],
	});
});

test("the built site has every file its pages and stylesheet link to", () => {
	const result = buildSite(input());
	if (!result.ok) throw new Error(result.errors.join("\n"));
	expect(siteLinkProblems(result.files).problems).toEqual([]);
});

test("finds a missing image, a missing anchor, a missing font and an unused image", () => {
	const result = buildSite(
		input({
			index: PAGE(
				'<img src="images/gone.png" alt=""><a href="changelog/#v9.9.9">Old</a><a href="https://github.com/jahala/conducted/blob/main/docs/architecture.md">Docs</a><!-- site:download --><!-- site:recent-releases -->',
			),
			css: "@font-face { src: url(fonts/Missing.woff2); }",
		}),
	);
	if (!result.ok) throw new Error(result.errors.join("\n"));
	const { problems, external } = siteLinkProblems(result.files);
	expect(problems).toEqual([
		"index.html links to images/gone.png, which the site does not have",
		"index.html links to changelog/index.html#v9.9.9, which has no such anchor",
		"style.css links to fonts/Missing.woff2, which the site does not have",
		"images/home.png is in the site but no page links to it",
	]);
	expect(external).toContain("https://github.com/jahala/conducted/blob/main/docs/architecture.md");
});

describe("the page's colours come from the app's tokens", () => {
	const root = join(import.meta.dir, "../..");
	const app = readFileSync(join(root, "apps/desktop/src/styles.css"), "utf8");
	const site = readFileSync(join(root, "docs/site/style.css"), "utf8");
	const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
	/** Each token's first value: the app's main theme, before the low-contrast and other sets. */
	const tokens = (css: string) => {
		const found = new Map<string, string>();
		for (const [, name = "", value = ""] of css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
			if (!found.has(name)) found.set(name, value.trim());
		}
		return found;
	};
	const hexes = (css: string) =>
		new Set(
			[...withoutComments(css).matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()),
		);

	test("a colour token the app also has carries the app's value", () => {
		const appTokens = tokens(app);
		const siteTokens = tokens(site);
		expect(siteTokens.size).toBeGreaterThan(0);
		for (const [name, value] of siteTokens) {
			expect({ name, value: value as string | undefined }).toEqual({
				name,
				value: appTokens.get(name),
			});
		}
	});

	test("every colour written in the stylesheet is one of the app's token values", () => {
		const appColours = hexes(app);
		const siteColours = hexes(site);
		expect(siteColours.size).toBeGreaterThan(0);
		const foreign = [...siteColours].filter((colour) => !appColours.has(colour));
		expect(foreign).toEqual([]);
	});
});
