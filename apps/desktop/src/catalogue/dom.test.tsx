// @vitest-environment jsdom
/**
 * @feature catalogue What an after-step does on the page, as a user would
 * Tests that the catalogue's click reaches a control the way a pointer click does. A pointer
 * click carries a click count of 1; a keyboard activation carries 0, and controls such as the
 * Loadout slot open their menu only for the first. Pointing at a control opens its tooltip, and a
 * key pressed in an area reaches that area's shortcuts.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { scopesForTarget } from "../app/command-dispatcher.ts";
import { Tooltip } from "../ui/Tooltip.tsx";
import { click, hover, press } from "./dom.ts";

afterEach(() => {
	cleanup();
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

describe("hover", () => {
	it("opens a tooltip, as a pointer moving onto the control does", async () => {
		render(
			<Tooltip content="Get an AI code review">
				<button type="button">Review</button>
			</Tooltip>,
		);

		await hover(document, "button", "Review");

		expect(
			(await screen.findAllByText("Get an AI code review", {}, { timeout: 2_000 })).length,
		).toBeGreaterThan(0);
	});
});

describe("press", () => {
	/** Takes a key only in the file viewer's area, as the app's Find in file does. */
	function listenInFileViewer(): () => void {
		const listener = (event: KeyboardEvent) => {
			if (scopesForTarget(event.target).includes("diff")) event.preventDefault();
		};
		document.addEventListener("keydown", listener);
		return () => document.removeEventListener("keydown", listener);
	}

	it("presses in the element `at` names, focused, so the key reaches that area", () => {
		document.body.innerHTML = `<div data-file-viewer><div class="cm-content" contenteditable="true"></div></div>`;
		const stop = listenInFileViewer();

		const taken = press(document, "f", { meta: true }, "[data-file-viewer] .cm-content");

		stop();
		expect(taken).toBe(true);
		expect(document.activeElement?.className).toBe("cm-content");
	});

	it("presses with nothing focused when no element is named", () => {
		document.body.innerHTML = `<div data-file-viewer><div class="cm-content" contenteditable="true"></div></div>`;
		const stop = listenInFileViewer();

		const taken = press(document, "f", { meta: true });

		stop();
		expect(taken).toBe(false);
	});

	it("is not taken while the element `at` names is not on the page", () => {
		const stop = listenInFileViewer();

		const taken = press(document, "f", { meta: true }, "[data-file-viewer] .cm-content");

		stop();
		expect(taken).toBe(false);
	});
});
