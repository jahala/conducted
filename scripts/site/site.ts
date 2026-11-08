/**
 * Builds the product page (issue #356): the home page and the Changelog page, from their templates
 * in docs/site, CHANGELOG.md and the latest GitHub release. Pure: the caller reads the files and the
 * release (scripts/site/build.ts), and this module returns the files of the site.
 *
 * - CHANGELOG.md is the one home of the release notes (PLAT-39). Each `## X.Y.Z (YYYY-MM-DD)`
 *   section becomes one entry, in the file's order (newest first, as scripts/release/changelog.ts
 *   writes it). Its anchor is the release's tag, `vX.Y.Z`, so the app's update notice can link to
 *   `changelog/#vX.Y.Z`.
 * - Templates carry markers (`<!-- site:name -->`) where generated parts go. A missing marker is an
 *   error, never a page with a hole.
 * - Download points at the `.dmg` of the latest release. With no release, or a release without a
 *   `.dmg`, the page says no signed build is published yet and points at building from source.
 * - `siteLinkProblems` checks the built site: every local link, image, stylesheet and font resolves
 *   to a file in it, every `#anchor` exists on its page, and every image is used. It also returns the
 *   site's links to other sites, so the caller can check the ones into this repository
 *   (scripts/guards/site.ts).
 *
 * Every text from CHANGELOG.md is HTML-escaped; inline `code` and `(#123)` pull request numbers are
 * the only markup it may carry.
 */
import { posix } from "node:path";

export const REPO_URL = "https://github.com/jahala/conducted";

export interface LatestRelease {
	tag: string;
	/** The release's page on GitHub. */
	url: string;
	/** The release's `.dmg`, or null when it has none. */
	dmg: { name: string; url: string } | null;
}

export interface SiteInput {
	/** docs/site/index.html */
	index: string;
	/** docs/site/changelog.html, written to changelog/index.html */
	changelogPage: string;
	/** docs/site/style.css */
	css: string;
	/** docs/site/images/, by file name */
	images: ReadonlyMap<string, Uint8Array>;
	/** The app's font files and their licence, by file name */
	fonts: ReadonlyMap<string, Uint8Array>;
	/** CHANGELOG.md */
	changelog: string;
	latest: LatestRelease | null;
}

export type SiteFiles = ReadonlyMap<string, string | Uint8Array>;

export interface Area {
	name: string;
	items: string[];
}

export interface Release {
	version: string;
	/** `YYYY-MM-DD` */
	date: string;
	anchor: string;
	areas: Area[];
	/** Lines under the heading that are neither an area heading nor a list item. */
	paragraphs: string[];
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** How many releases the home page shows; the rest are on the Changelog page. */
const RECENT = 3;
const HEADING = /^## (\d+\.\d+\.\d+(?:-[\w.]+)?) \((\d{4})-(\d{2})-(\d{2})\)\s*$/;
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** The releases in CHANGELOG.md, in the file's order. */
export function parseChangelog(markdown: string): Parsed<Release[]> {
	const releases: Release[] = [];
	let release: Release | null = null;
	let area: Area | null = null;
	for (const raw of markdown.split("\n")) {
		const line = raw.trimEnd();
		if (line.startsWith("## ")) {
			const match = HEADING.exec(line);
			if (match === null) {
				return {
					ok: false,
					error: `CHANGELOG.md: "${line}" is not a "## X.Y.Z (YYYY-MM-DD)" release heading`,
				};
			}
			const [, version = "", year = "", month = "", day = ""] = match;
			release = {
				version,
				date: `${year}-${month}-${day}`,
				anchor: `v${version}`,
				areas: [],
				paragraphs: [],
			};
			area = null;
			releases.push(release);
			continue;
		}
		if (release === null || line === "") continue;
		if (line.startsWith("### ")) {
			area = { name: line.slice(4).trim(), items: [] };
			release.areas.push(area);
		} else if (/^[-*] /.test(line)) {
			if (area === null) {
				area = { name: "", items: [] };
				release.areas.push(area);
			}
			area.items.push(line.slice(2).trim());
		} else {
			release.paragraphs.push(line.trim());
		}
	}
	return { ok: true, value: releases };
}

export function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** One line of release notes: escaped, with `code` spans and pull request numbers linked. */
function inline(text: string): string {
	return escapeHtml(text)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/(^|[\s(])#(\d+)\b/g, `$1<a href="${REPO_URL}/pull/$2">#$2</a>`);
}

/** `2026-11-09` as `November 9, 2026`, without a time zone in between. */
export function longDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return `${MONTHS[(month ?? 1) - 1]} ${day}, ${year}`;
}

/** A release card's two lines: how many changes, and the areas they touch. */
function releaseSummary(release: Release): { count: string; areas: string } {
	const total = release.areas.reduce((sum, area) => sum + area.items.length, 0);
	const names = release.areas.map((area) => area.name).filter((name) => name !== "");
	return {
		count: `${total} ${total === 1 ? "change" : "changes"}`,
		areas: escapeHtml(names.join(", ")),
	};
}

const EMPTY_RELEASES =
	'<div class="empty">No releases yet. Each release adds its notes here, newest first.</div>';

function renderReleases(releases: readonly Release[]): string {
	if (releases.length === 0) return EMPTY_RELEASES;
	return releases
		.map((release) => {
			const paragraphs = release.paragraphs.map((text) => `<p>${inline(text)}</p>`);
			const areas = release.areas.map((area) => {
				const heading = area.name === "" ? "" : `<h3>${escapeHtml(area.name)}</h3>`;
				const items = area.items.map((item) => `<li>${inline(item)}</li>`).join("");
				return `${heading}<ul>${items}</ul>`;
			});
			return [
				`<article class="release" id="${release.anchor}">`,
				'<header class="release-meta">',
				`<a class="pill" href="#${release.anchor}">${escapeHtml(release.version)}</a>`,
				`<time datetime="${release.date}">${longDate(release.date)}</time>`,
				"</header>",
				'<div class="release-notes">',
				...paragraphs,
				...areas,
				"</div>",
				"</article>",
			].join("\n");
		})
		.join("\n");
}

function renderRecentReleases(releases: readonly Release[]): string {
	if (releases.length === 0) return EMPTY_RELEASES;
	const cards = releases.slice(0, RECENT).map((release) => {
		const summary = releaseSummary(release);
		return [
			`<a class="release-card" href="changelog/#${release.anchor}">`,
			'<span class="release-meta">',
			`<span class="pill">${escapeHtml(release.version)}</span>`,
			`<time datetime="${release.date}">${longDate(release.date)}</time>`,
			"</span>",
			`<span class="release-card-count">${summary.count}</span>`,
			summary.areas === "" ? "" : `<span class="release-card-areas">${summary.areas}</span>`,
			"</a>",
		].join("");
	});
	return `<div class="release-cards">${cards.join("\n")}</div>`;
}

/** The download block: the latest release's `.dmg`, or a plain note that there is none yet. */
export function renderDownload(latest: LatestRelease | null): string {
	if (latest?.dmg) {
		return [
			'<div class="download-actions">',
			`<a class="button button-primary" href="${escapeHtml(latest.dmg.url)}">Download for Mac</a>`,
			`<a class="button" href="${escapeHtml(latest.url)}">Release notes</a>`,
			"</div>",
			`<p class="download-note">${escapeHtml(latest.tag)} · Apple silicon · signed and notarised by Apple</p>`,
		].join("\n");
	}
	return [
		'<div class="download-actions">',
		`<a class="button button-primary" href="${REPO_URL}#build-from-source">Build from source</a>`,
		`<a class="button" href="${REPO_URL}/releases">All releases</a>`,
		"</div>",
		'<p class="download-note">No signed build is published yet. When one is, it appears here.</p>',
	].join("\n");
}

function fill(
	template: string,
	file: string,
	parts: Readonly<Record<string, string>>,
	errors: string[],
): string {
	let html = template;
	for (const [name, content] of Object.entries(parts)) {
		const marker = `<!-- site:${name} -->`;
		if (!html.includes(marker)) errors.push(`${file} has no ${marker} marker`);
		else html = html.replace(marker, content);
	}
	return html;
}

/** Every file of the site, by its path in the site. */
export function buildSite(
	input: SiteInput,
): { ok: true; files: SiteFiles } | { ok: false; errors: string[] } {
	const parsed = parseChangelog(input.changelog);
	if (!parsed.ok) return { ok: false, errors: [parsed.error] };
	const releases = parsed.value;
	const errors: string[] = [];
	const index = fill(
		input.index,
		"index.html",
		{ download: renderDownload(input.latest), "recent-releases": renderRecentReleases(releases) },
		errors,
	);
	const changelog = fill(
		input.changelogPage,
		"changelog.html",
		{ releases: renderReleases(releases) },
		errors,
	);
	if (errors.length > 0) return { ok: false, errors };

	const files = new Map<string, string | Uint8Array>([
		["index.html", index],
		["changelog/index.html", changelog],
		["style.css", input.css],
	]);
	for (const [name, bytes] of input.images) files.set(`images/${name}`, bytes);
	for (const [name, bytes] of input.fonts) files.set(`fonts/${name}`, bytes);
	return { ok: true, files };
}

const LINK_ATTRIBUTE = /\s(?:href|src)="([^"]*)"/g;
const SRCSET = /\ssrcset="([^"]*)"/g;
const CSS_URL = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
const ID = /\sid="([^"]*)"/g;

function linksIn(path: string, text: string): string[] {
	if (path.endsWith(".css")) return [...text.matchAll(CSS_URL)].map((m) => m[1] ?? "");
	if (!path.endsWith(".html")) return [];
	const links = [...text.matchAll(LINK_ATTRIBUTE)].map((m) => m[1] ?? "");
	for (const [, set = ""] of text.matchAll(SRCSET)) {
		for (const candidate of set.split(",")) links.push(candidate.trim().split(/\s+/)[0] ?? "");
	}
	return links;
}

/** A local link resolved to a site path: a folder link means its index.html. */
function resolveLink(from: string, link: string): { path: string; anchor: string | null } {
	const [target = "", anchor] = link.split("#");
	if (target === "") return { path: from, anchor: anchor ?? null };
	let path = posix.normalize(posix.join(posix.dirname(from), target));
	if (target.endsWith("/") || path === ".") path = posix.join(path, "index.html");
	return { path, anchor: anchor ?? null };
}

/** Links in the built site that lead nowhere, images no page uses, and the links to other sites. */
export function siteLinkProblems(files: SiteFiles): { problems: string[]; external: string[] } {
	const problems: string[] = [];
	const external = new Set<string>();
	const used = new Set<string>();
	const ids = new Map<string, Set<string>>();
	for (const [path, content] of files) {
		if (typeof content === "string" && path.endsWith(".html")) {
			ids.set(path, new Set([...content.matchAll(ID)].map((m) => m[1] ?? "")));
		}
	}
	for (const [path, content] of files) {
		if (typeof content !== "string") continue;
		for (const link of linksIn(path, content)) {
			if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) {
				external.add(link);
				continue;
			}
			if (link === "") continue;
			const { path: target, anchor } = resolveLink(path, link);
			used.add(target);
			if (!files.has(target)) {
				problems.push(`${path} links to ${target}, which the site does not have`);
			} else if (anchor !== null && anchor !== "" && !ids.get(target)?.has(anchor)) {
				problems.push(`${path} links to ${target}#${anchor}, which has no such anchor`);
			}
		}
	}
	for (const path of files.keys()) {
		if (path.startsWith("images/") && !used.has(path)) {
			problems.push(`${path} is in the site but no page links to it`);
		}
	}
	return { problems, external: [...external] };
}
