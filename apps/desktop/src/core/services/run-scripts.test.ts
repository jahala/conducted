import { describe, expect, it } from "vitest";
import { detectLocalUrl, recordRunInHistory } from "./run-scripts.ts";

describe("detectLocalUrl", () => {
	it("returns null when there is no local URL", () => {
		expect(detectLocalUrl("compiled in 3s")).toBeNull();
		expect(detectLocalUrl("see https://example.com")).toBeNull();
	});
	it("takes the last local URL", () => {
		expect(detectLocalUrl("on http://localhost:3000 then http://127.0.0.1:5173/app")).toBe(
			"http://127.0.0.1:5173/app",
		);
	});
	it("rewrites wildcard hosts to localhost", () => {
		expect(detectLocalUrl("listening on http://0.0.0.0:8080")).toBe("http://localhost:8080");
		expect(detectLocalUrl("listening on http://[::]:8080/")).toBe("http://localhost:8080/");
	});
	it("does not swallow closing punctuation", () => {
		expect(detectLocalUrl("(http://localhost:3000)")).toBe("http://localhost:3000");
	});
});

describe("recordRunInHistory", () => {
	it("moves a repeated id to the front without duplicates", () => {
		expect(recordRunInHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
	});
	it("keeps at most 20", () => {
		const history = Array.from({ length: 20 }, (_, i) => `id${i}`);
		const next = recordRunInHistory(history, "new");
		expect(next).toHaveLength(20);
		expect(next[0]).toBe("new");
		expect(next).not.toContain("id19");
	});
});
