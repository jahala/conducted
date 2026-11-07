import { describe, expect, test } from "bun:test";
import { citations, screenIndex, WINDOW } from "./screens.ts";

const doc = [
	"## 3. App shell",
	"| Sidebar | 256px | M@433255 |",
	"### 3.3 Chat view",
	"Tool call row at R@8747084 and the composer at renderApp @9315568.",
].join("\n");

describe("placing an offset on a screen", () => {
	test("each citation keeps the heading it sits under", () => {
		expect(citations(doc, "ui-map")).toEqual([
			{ file: "main-BE1h_1MP.js", offset: 433255, section: "ui-map 3. App shell" },
			{ file: "renderApp-DeUrsznk.js", offset: 8747084, section: "ui-map 3.3 Chat view" },
			{ file: "renderApp-DeUrsznk.js", offset: 9315568, section: "ui-map 3.3 Chat view" },
		]);
	});

	test("the nearest citation in the same file wins, within the window only", () => {
		const screenFor = screenIndex(citations(doc, "ui-map"));
		expect(screenFor("renderApp-DeUrsznk.js", 8747100)).toBe("ui-map 3.3 Chat view");
		expect(screenFor("main-BE1h_1MP.js", 433255 + WINDOW)).toBe("ui-map 3. App shell");
		expect(screenFor("main-BE1h_1MP.js", 433255 + WINDOW + 1)).toBe("Unplaced");
		expect(screenFor("renderApp-DeUrsznk.js", 433255)).toBe("Unplaced");
		expect(screenFor("sidecar.js", 1)).toBe("Unplaced");
		expect(screenFor("renderApp-DeUrsznk.js", null)).toBe("Unplaced");
	});
});
