/**
 * @feature REV-02 Diff view
 * Runs the real @pierre/diffs renderer, with no stand-in, to prove the layout reaches the drawn
 * lines and that the whitespace preference reaches the renderer's own parser.
 */
import { parseDiffFromFile } from "@pierre/diffs";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FileDiff } from "../../core/api.ts";
import { DiffView } from "./DiffView.tsx";
import { toDiffOptions } from "./diff-options.ts";
import { diffThemeFor } from "./diff-theme.ts";
import type { DiffPreferences } from "./diff-types.ts";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "split",
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

	it("passes the no-ligatures rule into the drawn diff when the setting is off", async () => {
		const { container } = render(
			<DiffView
				diff={diff}
				preferences={{ ...preferences, ligatures: false }}
				forceRender={false}
				onForceRender={() => {}}
			/>,
		);
		const host = container.querySelector("diffs-container");
		await waitFor(
			() => {
				expect(host?.shadowRoot?.innerHTML ?? "").toContain("font-variant-ligatures: none");
			},
			{ timeout: 8_000 },
		);
	});

	it("colours a Rust diff with the user's theme and shows a line number per line", async () => {
		const rust: FileDiff = {
			path: "src/main.rs",
			oldText: "fn main() {}\n",
			newText: "fn main() {\n    let count = 1;\n}\n",
			patch: "",
			binary: false,
			tooLarge: false,
		};
		const { container } = render(
			<DiffView
				diff={rust}
				preferences={{ ...preferences, layout: "unified" }}
				theme={diffThemeFor("default", "dark")}
				forceRender={false}
				onForceRender={() => {}}
			/>,
		);
		const host = container.querySelector("diffs-container");
		await waitFor(
			() => {
				const html = host?.shadowRoot?.innerHTML ?? "";
				expect(html).toContain("var(--color-code-keyword)");
				expect(html).toContain("var(--color-code-number)");
				const numbers = Array.from(
					host?.shadowRoot?.querySelectorAll("[data-line-number-content]") ?? [],
				).map((node) => node.textContent);
				expect(numbers).toEqual(["1", "1", "2", "3"]);
			},
			{ timeout: 8_000 },
		);
	});

	it("colours a TypeScript diff with a named code theme", async () => {
		const ts: FileDiff = {
			path: "src/a.ts",
			oldText: "const a = 1;\n",
			newText: "const a = 2;\nexport { a };\n",
			patch: "",
			binary: false,
			tooLarge: false,
		};
		const { container } = render(
			<DiffView
				diff={ts}
				preferences={{ ...preferences, layout: "unified" }}
				theme={diffThemeFor("dracula", "dark")}
				forceRender={false}
				onForceRender={() => {}}
			/>,
		);
		const host = container.querySelector("diffs-container");
		await waitFor(
			() => {
				const html = host?.shadowRoot?.innerHTML ?? "";
				expect(html).toContain("data-line-number-content");
				expect(html).toMatch(/style="color:#[0-9a-fA-F]{6}"/);
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
