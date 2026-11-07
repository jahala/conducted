/**
 * A release tag must name the version every version file holds. A tag with a suffix after the
 * patch number is the dry run and becomes a pre-release.
 */
import { expect, test } from "bun:test";
import { readTag, tagProblems } from "./tag.ts";

const VERSIONS = [
	["package.json", "0.2.2"],
	["apps/desktop/package.json", "0.2.2"],
	["apps/desktop/src-tauri/tauri.conf.json", "0.2.2"],
	["apps/desktop/src-tauri/Cargo.toml", "0.2.2"],
	["apps/desktop/src-tauri/Cargo.lock", "0.2.2"],
] as const;

test("reads a release tag and its version", () => {
	expect(readTag("v0.2.2")).toEqual({ tag: "v0.2.2", version: "0.2.2", prerelease: false });
	expect(readTag("v0.2.2-rc.1")).toEqual({
		tag: "v0.2.2-rc.1",
		version: "0.2.2",
		prerelease: true,
	});
});

test("refuses a tag that is not v plus a version", () => {
	expect(readTag("0.2.2")).toBeNull();
	expect(readTag("v0.2")).toBeNull();
	expect(readTag("v0.2.2-")).toBeNull();
	const problems = tagProblems("release-0.2.2", VERSIONS);
	expect(problems).toHaveLength(1);
	expect(problems[0]).toContain("v<major>.<minor>.<patch>");
});

test("passes when every version file holds the tag's version", () => {
	expect(tagProblems("v0.2.2", VERSIONS)).toEqual([]);
});

test("reports every version file that disagrees, by name", () => {
	const versions = [
		["package.json", "0.2.2"],
		["apps/desktop/package.json", "0.2.1"],
		["apps/desktop/src-tauri/Cargo.toml", null],
	] as const;
	const problems = tagProblems("v0.2.2", versions);
	expect(problems).toEqual([
		"apps/desktop/package.json has version 0.2.1, but the tag v0.2.2 names 0.2.2.",
		"apps/desktop/src-tauri/Cargo.toml has no version, but the tag v0.2.2 names 0.2.2.",
	]);
});

test("a pre-release tag checks the version files against its base version", () => {
	expect(tagProblems("v0.2.2-rc.1", VERSIONS)).toEqual([]);
});
