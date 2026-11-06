// @vitest-environment node
/**
 * @feature RUN-04 Browser preview tab
 * Owns: the check that the app's content security policies let the preview probe and frame a
 * local dev server. jsdom ignores CSP, so the component tests cannot see a policy that blocks it.
 * Behaviour: ui-map.md 3.2 (the in-app browser preview of the workspace's dev server).
 * Test first: a policy with only `default-src 'self'` is refused for the preview origin.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREVIEW_SOURCES = ["http://localhost:*", "http://127.0.0.1:*"];

/** The sources a directive allows, falling back to `default-src` as browsers do. */
function sourcesOf(csp: string, directive: string): string[] {
	const directives = new Map(
		csp
			.split(";")
			.map((part) => part.trim().split(/\s+/))
			.filter((words) => words[0] !== undefined && words[0] !== "")
			.map((words) => [words[0] as string, words.slice(1)] as const),
	);
	return directives.get(directive) ?? directives.get("default-src") ?? [];
}

/** The directives the preview needs that do not allow both local origins. */
function previewGaps(csp: string): string[] {
	return ["frame-src", "connect-src"].filter((directive) => {
		const allowed = sourcesOf(csp, directive);
		return PREVIEW_SOURCES.some((source) => !allowed.includes(source));
	});
}

const config = JSON.parse(
	readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { app: { security: { csp: string; devCsp: string } } };

describe("RUN-04 content security policy", () => {
	it("refuses a policy that falls back to default-src 'self' for the preview", () => {
		expect(previewGaps("default-src 'self'; connect-src 'self' ipc:")).toEqual([
			"frame-src",
			"connect-src",
		]);
	});

	it("lets the shipped app probe and frame a local dev server", () => {
		expect(previewGaps(config.app.security.csp)).toEqual([]);
	});

	it("lets the dev build probe and frame a local dev server", () => {
		expect(previewGaps(config.app.security.devCsp)).toEqual([]);
	});
});
