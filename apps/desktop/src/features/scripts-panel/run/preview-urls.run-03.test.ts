/**
 * @feature RUN-03 Preview URL list
 * Owns: tests for building the list of preview URLs from the run output, detected ports and the
 * repository template.
 * Test first: template "http://localhost:$PORT/app" with port 3100 gives that URL with the port
 * substituted, and the same URL found in output is not listed twice.
 */
import { describe, expect, it } from "vitest";
import { buildPreviewUrls } from "./preview-urls.ts";

describe("RUN-03 buildPreviewUrls", () => {
	it("expands the template with the workspace port", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			template: "http://localhost:$PORT/app",
			workspacePort: 3100,
		});

		expect(problems).toEqual([]);
		expect(urls).toEqual([
			{ label: "Preview URL", url: "http://localhost:3100/app", source: "template" },
		]);
	});

	it("lists the same URL from two sources only once", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:3100",
			detectedPorts: [],
			template: "http://localhost:$PORT",
			workspacePort: 3100,
		});

		expect(urls.map((entry) => entry.url)).toEqual(["http://localhost:3100"]);
		expect(urls[0]?.source).toBe("run_output");
	});

	it("puts the run output first, then the detected ports in ascending order", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:4000/app?tab=one",
			detectedPorts: [5173, 3000, 5173],
			template: null,
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual([
			"http://localhost:4000/app?tab=one",
			"http://localhost:3000",
			"http://localhost:5173",
		]);
	});

	it("keeps every template entry in order so the first is the default", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			template: "http://localhost:$PORT\nhttps://example.test/preview",
			workspacePort: 55_010,
		});

		expect(urls.map((entry) => entry.url)).toEqual([
			"http://localhost:55010",
			"https://example.test/preview",
		]);
	});

	it("drops a template entry that is not a valid address and reports it", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			template: "not a url",
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});

	it("reports an unknown template variable", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [],
			template: "http://$HOST:$PORT",
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});

	it("ignores ports outside the valid range", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: null,
			detectedPorts: [0, 70_000, 3000],
			template: null,
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual(["http://localhost:3000"]);
	});
});
