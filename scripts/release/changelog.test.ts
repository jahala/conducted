/**
 * The changelog is written from the commit subjects since the last tag, grouped by their prefix,
 * newest release first. The release body is cut from that release's own section.
 */
import { expect, test } from "bun:test";
import { addRelease, releaseSection, sectionFor, subjectParts } from "./changelog.ts";

test("reads the area from a conventional prefix and drops the prefix from the line", () => {
	expect(subjectParts("docs: plan the release pipeline (#377)")).toEqual({
		area: "Docs",
		text: "plan the release pipeline (#377)",
	});
	expect(subjectParts("fix(APP-06): wait for the toast")).toEqual({
		area: "Fixes",
		text: "wait for the toast",
	});
	expect(subjectParts("test: a guard proves it can fail")).toEqual({
		area: "Tests",
		text: "a guard proves it can fail",
	});
});

test("puts a subject with no conventional prefix under Other and keeps it whole", () => {
	expect(subjectParts("Parity round 3: every gap names its owner (#372)")).toEqual({
		area: "Other",
		text: "Parity round 3: every gap names its owner (#372)",
	});
	expect(subjectParts("CLOUD-01: each workspace carries a host")).toEqual({
		area: "Other",
		text: "CLOUD-01: each workspace carries a host",
	});
});

test("writes one release heading with its areas, newest and Other last", () => {
	const section = releaseSection({
		version: "0.2.2",
		date: "2026-11-07",
		commits: [
			"docs: plan the release pipeline (#377)",
			"fix: stop the tag check lying",
			"Overnight report (#371)",
		],
	});

	expect(section).toBe(
		[
			"## 0.2.2 (2026-11-07)",
			"",
			"### Docs",
			"",
			"- plan the release pipeline (#377)",
			"",
			"### Fixes",
			"",
			"- stop the tag check lying",
			"",
			"### Other",
			"",
			"- Overnight report (#371)",
		].join("\n"),
	);
});

test("adds a new release above the older ones, so the newest comes first", () => {
	const older = "# Changelog\n\n## 0.2.1 (2026-11-06)\n\n### Fixes\n\n- an old fix\n";
	const section = releaseSection({
		version: "0.2.2",
		date: "2026-11-07",
		commits: ["docs: plan the release pipeline"],
	});

	expect(addRelease(older, section)).toBe(
		[
			"# Changelog",
			"",
			"## 0.2.2 (2026-11-07)",
			"",
			"### Docs",
			"",
			"- plan the release pipeline",
			"",
			"## 0.2.1 (2026-11-06)",
			"",
			"### Fixes",
			"",
			"- an old fix",
			"",
		].join("\n"),
	);
});

test("adds the first release under the bare title", () => {
	const section = releaseSection({
		version: "0.2.2",
		date: "2026-11-07",
		commits: ["feat: the first release"],
	});

	expect(addRelease("# Changelog\n", section)).toBe(
		[
			"# Changelog",
			"",
			"## 0.2.2 (2026-11-07)",
			"",
			"### Features",
			"",
			"- the first release",
			"",
		].join("\n"),
	);
});

test("cuts a release body from its own section only", () => {
	const changelog = [
		"# Changelog",
		"",
		"## 0.2.2 (2026-11-07)",
		"",
		"### Docs",
		"",
		"- plan the release pipeline",
		"",
		"## 0.2.1 (2026-11-06)",
		"",
		"### Fixes",
		"",
		"- an old fix",
	].join("\n");

	expect(sectionFor(changelog, "0.2.2")).toBe("### Docs\n\n- plan the release pipeline");
	expect(sectionFor(changelog, "0.2.1")).toBe("### Fixes\n\n- an old fix");
	expect(sectionFor(changelog, "0.3.0")).toBeNull();
});
