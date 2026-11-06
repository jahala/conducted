import { describe, expect, it } from "vitest";
import { changesCacheFile, prInfoCacheFile } from "./git-cache.ts";

const paths = {
	home: "/Users/a/",
	appData: "/Users/a/Library/App/",
	temp: "/tmp",
	resources: "/App/Resources",
};

describe("git cache paths", () => {
	it("keeps the git caches in their own folders", () => {
		expect(changesCacheFile(paths, "w1")).toBe("/Users/a/Library/App/git-cache/changes/w1.json");
		expect(prInfoCacheFile(paths, "w1")).toBe("/Users/a/Library/App/git-cache/pr-info/w1.json");
	});
});
