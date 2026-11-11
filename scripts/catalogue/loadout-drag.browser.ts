/**
 * @feature SET-02 Loadout editor on the Default models page
 * Owns: the browser check that a real pointer drag puts a model into an empty Loadout slot, that a
 * real pointer drag moves a filled slot onto another, and that a filled slot dragged outside the
 * slots leaves the loadout, in the environment the app's window gives the page.
 * Behaviour: Conductor's Loadout (renderApp, the models tab's "Loadout" row) drags with pointer
 * events and motion, not HTML5 drag and drop: its slots are hit-tested from the pointer's point
 * against each slot's rectangle with a 16px margin, the nearest slot's centre winning. That is why
 * it works in the app's window, where Tauri's window drag-drop handling (`dragDropEnabled`, on for
 * file drops into the composer) takes a native drag before the page sees it.
 * Must handle: the page receives no HTML5 drag events, as in the app's window; a slot dropped
 * outside every slot is removed; a slot dragged onto another reorders the loadout.
 * Our design choice: the check runs in the catalogue (scripts/catalogue/shots.ts starts it), in
 * Playwright's Chromium, and closes the window's HTML5 drag events at `window` in the capture
 * phase to stand in for Tauri's handler. The pointer events are real mouse input.
 * Test first: drags a model into an empty slot with pointer events.
 *
 * Usage: bun scripts/catalogue/loadout-drag.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { startServer, stopServer } from "./shots.ts";

/** The catalogue state: the Default models page over the real app entry and in-memory Platform. */
const STATE = "settings-default-models";
/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;

/**
 * The app's window gives the page no HTML5 drag events: Tauri's drag-drop handling takes the
 * native drag (it has to, for file drops into the composer). Closing them at `window` in the
 * capture phase is the closest a browser stand-in gets to that window.
 */
async function appWindow(page: Page): Promise<void> {
	await page.addInitScript(() => {
		for (const type of ["dragstart", "dragenter", "dragover", "dragleave", "drop", "dragend"]) {
			window.addEventListener(type, (event) => event.stopImmediatePropagation(), true);
		}
	});
}

/** A real pointer drag: press the middle of `from`, move past the drag threshold, release at `to`. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
	const box = await from.boundingBox();
	if (box === null) throw new Error("The drag source has no box.");
	const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	// The first move passes the drag threshold, so a press that never moves stays a click.
	await page.mouse.move(start.x + 8, start.y + 8, { steps: 4 });
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

/** The point at the middle of an element, for a drag's target. */
async function middle(element: Locator): Promise<{ x: number; y: number }> {
	const box = await element.boundingBox();
	if (box === null) throw new Error("The drag target has no box.");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether a locator shows within the hang limit, without a fixed wait. */
async function shows(locator: Locator): Promise<boolean> {
	try {
		await locator.waitFor({ state: "visible", timeout: HANG_MS });
		return true;
	} catch {
		return false;
	}
}

/** Opens the catalogue state in a fresh page whose drag events Tauri's window takes. */
async function open(browser: Browser, url: string): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await appWindow(page);
	const address = `${url}?${new URLSearchParams({ state: STATE, theme: "light" }).toString()}`;
	await page.goto(address, { timeout: HANG_MS });
	await page.locator('html[data-catalogue="ready"]').waitFor({ timeout: HANG_MS });
	return page;
}

async function main(): Promise<number> {
	const server = startServer();
	let browser: Browser | null = null;
	let failed = 0;
	const check = (name: string, pass: boolean, detail: string): void => {
		if (!pass) failed += 1;
		console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: ${detail}`}`);
	};
	try {
		const url = await server.url;
		browser = await chromium.launch();

		// The deciding case: a model row dragged with the pointer into the next empty slot.
		const added = await open(browser, url);
		try {
			const slot = added.getByRole("listitem", { name: "Slot 2" });
			const row = added.getByRole("button", { name: "Add Sonnet 4.6 to loadout" });
			await drag(added, row, await middle(slot));
			check(
				"drags a model into an empty slot with pointer events",
				await shows(slot.getByText("Sonnet 4.6")),
				(await slot.textContent()) ?? "",
			);
		} finally {
			await added.close();
		}

		// A filled slot dragged onto another reorders the loadout, as in Conductor.
		const reordered = await open(browser, url);
		try {
			const first = reordered.getByRole("listitem", { name: "Slot 2" });
			const second = reordered.getByRole("listitem", { name: "Slot 3" });
			const sonnet = reordered.getByRole("button", { name: "Add Sonnet 4.6 to loadout" });
			await drag(reordered, sonnet, await middle(first));
			await reordered.getByRole("button", { name: "Add GPT-5.5 to loadout" }).press("Enter");
			if (!(await shows(second.getByText("GPT-5.5")))) {
				check(
					"drags a filled slot onto another to reorder",
					false,
					"the second model never landed",
				);
			} else {
				await drag(reordered, second.getByRole("button"), await middle(first));
				check(
					"drags a filled slot onto another to reorder",
					(await shows(first.getByText("GPT-5.5"))) &&
						(await shows(second.getByText("Sonnet 4.6"))),
					`${(await first.textContent()) ?? ""} / ${(await second.textContent()) ?? ""}`,
				);
			}
		} finally {
			await reordered.close();
		}

		// A filled slot dragged outside the slots leaves the loadout, as in Conductor.
		const removed = await open(browser, url);
		try {
			const slot = removed.getByRole("listitem", { name: "Slot 2" });
			const row = removed.getByRole("button", { name: "Add Sonnet 4.6 to loadout" });
			await drag(removed, row, await middle(slot));
			if (!(await shows(slot.getByText("Sonnet 4.6")))) {
				check(
					"drags a filled slot outside the slots to remove it",
					false,
					"the model never landed",
				);
			} else {
				const heading = removed.getByRole("heading", { name: "Default models" });
				await drag(removed, slot.getByRole("button"), await middle(heading));
				check(
					"drags a filled slot outside the slots to remove it",
					await shows(slot.getByText("DROP MODEL HERE")),
					(await slot.textContent()) ?? "",
				);
			}
		} finally {
			await removed.close();
		}
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error);
			process.exit(1);
		},
	);
}
