/**
 * Writes the release notes (PLAT-39): the commit subjects since the last tag, grouped by the area
 * their prefix names, under one `## X.Y.Z (date)` heading, newest release first. `CHANGELOG.md`
 * is the one home of the notes. The workflow cuts a release's body from its own section.
 *
 * Our design choice: the area is the Conventional Commit type when the subject has one, and
 * otherwise the prefix word itself. A subject without a prefix goes under "Other". The line drops
 * the prefix, so the text under a heading is not repeated there.
 */

export interface ReleaseNotes {
	version: string;
	/** The release date, as `YYYY-MM-DD`. */
	date: string;
	/** Commit subjects, newest first, as `git log --format=%s` gives them. */
	commits: readonly string[];
}

const AREA_NAMES: Readonly<Record<string, string>> = {
	build: "Build",
	chore: "Chores",
	ci: "CI",
	doc: "Docs",
	docs: "Docs",
	feat: "Features",
	feature: "Features",
	fix: "Fixes",
	perf: "Performance",
	refactor: "Refactors",
	release: "Releases",
	style: "Style",
	test: "Tests",
	tests: "Tests",
};

/** `type(scope)!: text`, the shape a grouped subject may take. */
const PREFIX = /^([A-Za-z][\w-]*)(?:\([^)]*\))?!?:\s+(\S.*)$/;

/** A prefix that is a backlog id, such as `CLOUD-01`, not an area. */
const FEATURE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** The area and displayed text of one commit subject. */
export function subjectParts(subject: string): { area: string; text: string } {
	const match = PREFIX.exec(subject);
	const prefix = match?.[1];
	const text = match?.[2];
	if (prefix === undefined || text === undefined || FEATURE_ID.test(prefix)) {
		return { area: "Other", text: subject };
	}
	const named = AREA_NAMES[prefix.toLowerCase()];
	const area = named ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
	return { area, text };
}

/** One release section: its heading, then one `### Area` list per area, Other last. */
export function releaseSection(notes: ReleaseNotes): string {
	const groups = new Map<string, string[]>();
	for (const subject of notes.commits) {
		const { area, text } = subjectParts(subject);
		groups.set(area, [...(groups.get(area) ?? []), text]);
	}

	const areas = [...groups.keys()].sort((a, b) => {
		if (a === "Other") return 1;
		if (b === "Other") return -1;
		return a.localeCompare(b);
	});

	const lines = [`## ${notes.version} (${notes.date})`];
	for (const area of areas) {
		lines.push("", `### ${area}`, "");
		for (const text of groups.get(area) ?? []) lines.push(`- ${text}`);
	}
	return lines.join("\n");
}

/** The same changelog with a new release above the older ones: newest release first. */
export function addRelease(changelog: string, section: string): string {
	const text = changelog.trimStart();
	const older = /^## /m.exec(text)?.index ?? -1;
	if (older === -1) return `${text.trimEnd()}\n\n${section}\n`;
	const before = text.slice(0, older).trimEnd();
	const after = text.slice(older).trimStart();
	return `${[before, section, after].join("\n\n").trimEnd()}\n`;
}

/** The body of one version's section, without its heading, or null when it has none. */
export function sectionFor(changelog: string, version: string): string | null {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## ${version} `));
	if (start === -1) return null;
	const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	const end = next === -1 ? lines.length : next;
	return lines
		.slice(start + 1, end)
		.join("\n")
		.trim();
}
