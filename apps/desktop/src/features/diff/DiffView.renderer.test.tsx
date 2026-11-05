/**
 * @feature REV-02 Diff view
 * Runs the real @pierre/diffs renderer, with no stand-in, to prove the layout reaches the drawn
 * lines and that the whitespace preference reaches the renderer's own parser.
 */
import { parseDiffFromFile } from "@pierre/diffs";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FileDiff } from "../../core/api.ts";
import "../../test/dom-polyfills.ts";
import { DiffView } from "./DiffView.tsx";
import { toDiffOptions } from "./diff-options.ts";
import type { DiffPreferences } from "./diff-types.ts";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "split",
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const diff: FileDiff = {
	path: "src/a.ts",
	oldText: "one\ntwo\nthree\n",
	newText: "one\nTWO\nthree\n",
	patch: "",
	binary: false,
	tooLarge: false,
};

describe("REV-02 DiffView with the real renderer", () => {
	it("draws the changed line in the split layout with wrapped lines", async () => {
		const { container } = render(
			<DiffView
				diff={diff}
				preferences={preferences}
				forceRender={false}
				onForceRender={() => {}}
			/>,
		);
		const host = container.querySelector("diffs-container");
		expect(host).not.toBeNull();
		await waitFor(
			() => {
				const shadow = host?.shadowRoot;
				expect(shadow?.textContent ?? "").toContain("TWO");
				const html = shadow?.innerHTML ?? "";
				expect(html).toContain('data-diff-type="split"');
				expect(html).toContain('data-overflow="wrap"');
			},
			{ timeout: 8_000 },
		);
	});

	it("hides a whitespace-only change through the renderer's own parser", () => {
		const theme = { name: "pierre-light", type: "light" as const };
		const hidden = toDiffOptions({ ...preferences, hideWhitespaceChanges: true }, theme);
		const shown = toDiffOptions({ ...preferences, hideWhitespaceChanges: false }, theme);
		const oldFile = { name: "a.ts", contents: "a b\n" };
		const newFile = { name: "a.ts", contents: "  a b\n" };
		expect(parseDiffFromFile(oldFile, newFile, hidden.parseDiffOptions).hunks).toHaveLength(0);
		expect(
			parseDiffFromFile(oldFile, newFile, shown.parseDiffOptions).hunks.length,
		).toBeGreaterThan(0);
	});
});
