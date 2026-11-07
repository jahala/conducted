// @vitest-environment jsdom
/**
 * @feature catalogue What an after-step does on the page, as a user would
 * Tests that the catalogue's click reaches a control the way a pointer click does. A pointer
 * click carries a click count of 1; a keyboard activation carries 0, and controls such as the
 * Loadout slot open their menu only for the first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { click } from "./dom.ts";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("click", () => {
	it("sends a click with a click count of 1, as a pointer does", async () => {
		document.body.innerHTML = `<button type="button">Claude Code Opus 4.7</button>`;
		const counts: number[] = [];
		document.querySelector("button")?.addEventListener("click", (event) => {
			counts.push(event.detail);
		});

		await click(document, "button", "Claude Code", { prefix: true });

		expect(counts).toEqual([1]);
	});

	it("still runs a control's own click behaviour", async () => {
		document.body.innerHTML = `<label><input type="checkbox" />Auto sync</label>`;

		await click(document, "label", "Auto sync");

		expect(document.querySelector("input")?.checked).toBe(true);
	});
});
