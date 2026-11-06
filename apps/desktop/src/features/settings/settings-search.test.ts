import { describe, expect, it } from "vitest";
import { type SearchableSetting, searchSettings } from "./settings-search.ts";

const setting = (
	changes: Partial<SearchableSetting> & Pick<SearchableSetting, "key" | "title">,
): SearchableSetting => ({
	description: "",
	keywords: [],
	page: "general",
	...changes,
});

const index: SearchableSetting[] = [
	setting({ key: "zoom", title: "App zoom", description: "Scale of the interface." }),
	setting({ key: "theme", title: "Code theme", description: "Colors for code." }),
];

describe("SET-02 settings search", () => {
	it("returns only the matching setting, whatever the letter case", () => {
		expect(searchSettings(index, "zom", 30).map((entry) => entry.key)).toEqual(["zoom"]);
		expect(searchSettings(index, "ZOM", 30).map((entry) => entry.key)).toEqual(["zoom"]);
	});

	it("ranks a title match above a description match and a keyword match", () => {
		const ranked = searchSettings(
			[
				setting({ key: "keyword", title: "Other", keywords: ["zoom"] }),
				setting({ key: "description", title: "Other", description: "zoom" }),
				setting({ key: "title", title: "App zoom" }),
			],
			"zoom",
			30,
		);
		expect(ranked.map((entry) => entry.key)).toEqual(["title", "description", "keyword"]);
	});

	it("lists every matching setting before any matching command", () => {
		const ranked = searchSettings(
			[
				setting({ key: "zoom_level_v2", title: "App zoom" }),
				setting({ key: "command:view.zoomIn", title: "Zoom in", page: "key-bindings" }),
				setting({ key: "command:view.zoomOut", title: "Zoom out", page: "key-bindings" }),
				setting({ key: "terminal", title: "Terminal size", keywords: ["zoom"] }),
			],
			"zoom",
			3,
		);
		expect(ranked.map((entry) => entry.key)).toEqual([
			"zoom_level_v2",
			"terminal",
			"command:view.zoomIn",
		]);
	});

	it("returns nothing for a blank query or a limit of zero", () => {
		expect(searchSettings(index, "   ", 30)).toEqual([]);
		expect(searchSettings(index, "zoom", 0)).toEqual([]);
	});

	it("requires every word to match", () => {
		expect(searchSettings(index, "app zoom", 30).map((entry) => entry.key)).toEqual(["zoom"]);
		expect(searchSettings(index, "app theme", 30)).toEqual([]);
	});
});
