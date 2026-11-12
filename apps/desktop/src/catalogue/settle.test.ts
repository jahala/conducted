// @vitest-environment jsdom
/**
 * @feature catalogue When a catalogue state counts as settled
 * Tests that a state settles only while its screen still shows what it is about. A menu the
 * after-step opened can close a moment later (the composer takes the focus once it has loaded, and
 * a menu closes when the focus leaves it); the screenshot and the parity dump would then draw a
 * screen without the menu, so such a state must fail instead of counting as ready.
 */
import { afterEach, describe, expect, it } from "vitest";
import { shows } from "./dom.ts";
import { settle, waitForQuiet } from "./settle.ts";

const IDLE = { routerIdle: () => true, queriesIdle: () => true };

afterEach(() => {
	document.body.innerHTML = "";
});

describe("settle", () => {
	it("settles a state that keeps showing what it is about", async () => {
		document.body.innerHTML = `<div role="menu">Cycle effort</div>`;

		await expect(
			settle("menu-open", (document) => shows(document, "Cycle effort"), IDLE),
		).resolves.toBeUndefined();
	});

	it("fails a state whose screen showed what it is about, then lost it", async () => {
		document.body.innerHTML = `<div role="menu">Cycle effort</div>`;
		// The menu closes a few frames after the ready check first held, as a focus change closes it.
		setTimeout(() => document.querySelector("[role=menu]")?.remove(), 50);

		await expect(
			settle("menu-closes", (document) => shows(document, "Cycle effort"), IDLE),
		).rejects.toThrow('"menu-closes" showed what it is about, then lost it');
	});
});

describe("waitForQuiet", () => {
	it("returns only once the page has stopped changing", async () => {
		document.body.innerHTML = `<p>loading</p>`;
		let changes = 0;
		const timer = setInterval(() => {
			changes++;
			document.body.innerHTML = `<p>step ${changes}</p>`;
			if (changes === 5) clearInterval(timer);
		}, 20);

		await waitForQuiet(document.body);

		expect(changes).toBe(5);
	});
});
