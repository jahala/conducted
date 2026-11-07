/**
 * @feature RUN-03 Preview URL list
 * Owns: tests for building the list of preview URLs from the repository's ordered preview URL
 * entries and the run output.
 * Test first: a template is labelled by its name, or by its expanded URL when the name is empty.
 */
import { describe, expect, it } from "vitest";
import { buildPreviewUrls } from "./preview-urls.ts";

describe("RUN-03 buildPreviewUrls", () => {
	it("labels a template by its name, or by its expanded URL when the name is empty", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			templates: [
				{ name: "App", url: "http://localhost:$PORT/app" },
				{ name: "", url: "https://example.test/preview" },
			],
			workspacePort: 3100,
		});

		expect(problems).toEqual([]);
		expect(urls).toEqual([
			{ label: "App", url: "http://localhost:3100/app", source: "template" },
			{
				label: "https://example.test/preview",
				url: "https://example.test/preview",
				source: "template",
			},
		]);
	});

	it("uses the run-output URL only when no template is set", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:4000/app?tab=one",
			templates: [],
			workspacePort: 55_000,
		});

		expect(urls).toEqual([
			{
				label: "http://localhost:4000/app?tab=one",
				url: "http://localhost:4000/app?tab=one",
				source: "run_output",
			},
		]);
	});

	it("leaves the run-output URL out when templates exist", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: "http://localhost:4000/app",
			templates: [{ name: "App", url: "http://localhost:$PORT" }],
			workspacePort: 55_000,
		});

		expect(urls.map((entry) => entry.url)).toEqual(["http://localhost:55000"]);
	});

	it("keeps the templates in order so the first is the default", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: null,
			templates: [
				{ name: "One", url: "https://example.test/one" },
				{ name: "Two", url: "http://localhost:$PORT" },
			],
			workspacePort: 55_010,
		});

		expect(urls.map((entry) => entry.url)).toEqual([
			"https://example.test/one",
			"http://localhost:55010",
		]);
	});

	it("lists the same URL from two entries only once", () => {
		const { urls } = buildPreviewUrls({
			runOutputUrl: null,
			templates: [
				{ name: "One", url: "http://localhost:$PORT" },
				{ name: "Two", url: "http://localhost:$PORT" },
			],
			workspacePort: 3100,
		});

		expect(urls).toHaveLength(1);
		expect(urls[0]?.label).toBe("One");
	});

	it("drops a template entry that is not a valid address and reports it", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			templates: [{ name: "Bad", url: "not a url" }],
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});

	it("reports an unknown template variable", () => {
		const { urls, problems } = buildPreviewUrls({
			runOutputUrl: null,
			templates: [{ name: "", url: "http://$HOST:$PORT" }],
			workspacePort: 55_010,
		});

		expect(urls).toEqual([]);
		expect(problems).toHaveLength(1);
	});
});
