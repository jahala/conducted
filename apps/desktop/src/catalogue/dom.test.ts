// @vitest-environment jsdom
/**
 * @feature catalogue What an after-step does on the page, as a user would
 * Tests that waiting for a control is bounded by time, sized to catch a hang. A busy CI runner
 * draws frames slowly or late; a control that takes ten seconds of frames to appear is slowness,
 * and the step must still find it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { find } from "./dom.ts";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance", "setTimeout", "Date"] });
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("find", () => {
	it("finds a control that appears after ten seconds of frames", async () => {
		const found = find(document, "button", "Open redirect.png");
		await vi.advanceTimersByTimeAsync(10_000);
		document.body.innerHTML = `<button>Open redirect.png</button>`;
		await vi.advanceTimersByTimeAsync(100);

		expect((await found).textContent).toBe("Open redirect.png");
	});

	it("gives up on a control that never appears, naming it", async () => {
		const found = find(document, "button", "Never there");
		const failed = expect(found).rejects.toThrow('No button named "Never there" appeared.');
		await vi.advanceTimersByTimeAsync(60_000);

		await failed;
	});
});
