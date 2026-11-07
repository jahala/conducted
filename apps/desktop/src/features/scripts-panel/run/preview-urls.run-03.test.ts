/**
 * @feature RUN-03 Preview URL list
 * Owns: tests for building the list of preview URLs from the run output, detected ports and the
 * repository's ordered preview URL list.
 * Test first: the templates keep their order, so the first is the default.
 */
import { describe, expect, it } from "vitest";
import { buildPreviewUrls } from "./preview-urls.ts";

describe("RUN-03 buildPreviewUrls", () => {
	it("expands a template with the workspace port", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			templates: ["http://localhost:$PORT/app"],
			workspacePort: 3100,
		});

		expect(problems).toEqual([]);
		expect(urls).toEqual([
			{ label: "http://localhost:3100/app", url: "http://localhost:3100/app", source: "template" },
		]);
	});

	it("lists the same URL from two sources only once", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:3100",
			detectedPorts: [],
			templates: ["http://localhost:$PORT"],
			workspacePort: 3100,
		});

		expect(urls.map((entry) => entry.url)).toEqual(["http://localhost:3100"]);
		expect(urls[0]?.source).toBe("template");
	});

	it("keeps the templates in order so the first is the default, then the run output and ports", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:4000/app?tab=one",
			detectedPorts: [5173, 3000, 5173],
			templates: ["https://example.test/preview", "http://localhost:$PORT"],
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual([
			"https://example.test/preview",
			"http://localhost:55000",
			"http://localhost:4000/app?tab=one",
			"http://localhost:3000",
			"http://localhost:5173",
		]);
	});

	it("puts the run output first when no template is set", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:4000/app?tab=one",
			detectedPorts: [5173, 3000],
			templates: [],
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual([
			"http://localhost:4000/app?tab=one",
			"http://localhost:3000",
			"http://localhost:5173",
		]);
	});

	it("drops a template entry that is not a valid address and reports it", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			templates: ["not a url"],
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});

	it("reports an unknown template variable", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			templates: ["http://$HOST:$PORT"],
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});

	it("ignores ports outside the valid range", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [0, 70_000, 3000],
			templates: [],
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual(["http://localhost:3000"]);
	});
});
