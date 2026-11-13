/**
 * @feature REV-01 Git panel tab strip
 * Owns: the browser check that the git panel's tab strip keeps Review and the open tab's buttons
 * (All files' "Select working directories") whole inside the panel, at the app's default window and
 * at its smallest, with the Artifacts tab on.
 * Behaviour: Conductor's strip (renderApp `POs` @2553124) is `min-w-0 overflow-hidden`; its tabs sit
 * in a scroller that takes the room left (`kKe`, `flex-1 min-w-0`), and Review with the tab's
 * buttons sit after it in a group that never shrinks (`flex shrink-0`). So a narrow panel scrolls
 * the tabs and never cuts Review. jsdom has no layout, so only a browser can measure this.
 * Must handle: the default 1440 x 900 window and the 960 x 600 smallest one (tauri.conf.json), the
 * panel at its default share of the window.
 * Our design choice: the check opens the catalogue state git-files, the All files tab of a
 * workspace whose project shows the Artifacts tab, in Playwright's Chromium.
 * Test first: at 960 x 600, Review and "Select working directories" end inside the git panel.
 *
 * Usage: bun scripts/catalogue/git-tabs.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { startServer, stopServer } from "./shots.ts";

const STATE = "git-files";
/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;
const WINDOWS = [
	{ width: 1440, height: 900 },
	{ width: 960, height: 600 },
];
/** The buttons that must stay whole, by accessible name. */
const BUTTONS = ["Review", "Select working directories"];

interface Strip {
	panelRight: number;
	/** Each button's right edge, or null when it is not on the page. */
	buttons: Record<string, number | null>;
	/** Each tab's label, with whether it can still be reached (scrolled to or shown). */
	tabs: { label: string; reachable: boolean }[];
}

async function measure(browser: Browser, url: string, viewport: (typeof WINDOWS)[number]) {
	const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
	try {
		await page.clock.setFixedTime(CATALOGUE_NOW);
		const address = `${url}?${new URLSearchParams({ state: STATE, theme: "light" }).toString()}`;
		await page.goto(address, { timeout: HANG_MS });
		const html = page.locator("html[data-catalogue]");
		await html.waitFor({ state: "attached", timeout: HANG_MS });
		const status = await html.getAttribute("data-catalogue");
		if (status !== "ready") {
			throw new Error(
				`${STATE} ended ${status}: ${await html.getAttribute("data-catalogue-error")}`,
			);
		}
		return (await page.evaluate((names: string[]) => {
			const tab = [...document.querySelectorAll('[role="tab"]')].find(
				(node) => node.textContent?.trim() === "All files",
			);
			const panel = tab?.closest('[data-panel-id="git-panel"], [id="git-panel"]') ?? null;
			const strip = tab?.closest('[role="tablist"]')?.parentElement?.parentElement ?? null;
			const box = (panel ?? strip)?.getBoundingClientRect();
			if (box === undefined) throw new Error("The git panel's tab strip is not on the page.");
			const buttons: Record<string, number | null> = {};
			for (const name of names) {
				const button = [...document.querySelectorAll("button")].find(
					(node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name,
				);
				buttons[name] = button === undefined ? null : button.getBoundingClientRect().right;
			}
			const tabs = [
				...(tab?.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? []),
			].map((node) => {
				let scroller: HTMLElement | null = node.parentElement;
				while (scroller !== null && scroller.scrollWidth <= scroller.clientWidth) {
					scroller = scroller.parentElement;
				}
				const right = node.getBoundingClientRect().right;
				const reachable =
					right <= box.right + 1 ||
					(scroller !== null && getComputedStyle(scroller).overflowX === "auto");
				return { label: node.textContent?.trim() ?? "", reachable };
			});
			return { panelRight: box.right, buttons, tabs };
		}, BUTTONS)) as Strip;
	} finally {
		await page.close();
	}
}

async function main(): Promise<number> {
	const server = startServer();
	let browser: Browser | null = null;
	let failed = 0;
	try {
		const url = await server.url;
		browser = await chromium.launch();
		for (const viewport of WINDOWS) {
			const strip = await measure(browser, url, viewport);
			const faults: string[] = [];
			for (const [name, right] of Object.entries(strip.buttons)) {
				if (right === null) faults.push(`${name} is missing`);
				else if (right > strip.panelRight + 1) {
					faults.push(
						`${name} ends at ${Math.round(right)}, past the panel's ${Math.round(strip.panelRight)}`,
					);
				}
			}
			for (const tab of strip.tabs)
				if (!tab.reachable) faults.push(`the ${tab.label} tab is cut off`);
			const pass = faults.length === 0;
			if (!pass) failed += 1;
			console.log(
				`${pass ? "ok  " : "FAIL"} at ${viewport.width} x ${viewport.height} the strip keeps Review and its buttons whole${pass ? "" : `: ${faults.join("; ")}`}`,
			);
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
