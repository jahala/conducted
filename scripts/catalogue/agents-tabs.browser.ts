/**
 * @feature SET-03 Agents settings page
 * Owns: the browser check that the Agents page's tab row holds every agent's tab at the app's
 * default window, spans the page as Conductor's does, and never grows a scrollbar.
 * Behaviour: issue #625. On GitHub's macOS 15 runner the tab list read scrollWidth 358 and
 * clientWidth 345, so "Pi" sat behind a sideways scroll. Chromium reads the same row's content as
 * 358px to the pixel, so the labels were no wider there: the list lost 13px to a scrollbar. Our
 * list was a scroll container one pixel shorter than its tabs (each tab's -mb-px), and a Mac whose
 * scrollbars take space (a mouse, or a runner with no trackpad) draws a vertical scrollbar in it.
 * Conductor's list clips and never scrolls (renderApp @4392128, `min-w-0 overflow-hidden
 * max-w-full`; a tab is `min-w-0 overflow-hidden whitespace-nowrap` with no negative margin,
 * @4392863), and on Agents it is alone across the page (@11008592 `mb-6 justify-start gap-6
 * border-b`, in a `w-full` root @11009380). jsdom has no layout, so only a browser can measure this.
 * Must handle: the labels at their own size; the labels 4% larger (a wider system font); scrollbars
 * that take space; a row too narrow for its tabs must be reported (the instrument is proved on a
 * known case).
 * Our design choice: the check reads the catalogue state settings-agents in Playwright's Chromium at
 * 1440 x 900, the size tauri.conf.json opens. Chromium starts without Playwright's
 * `--hide-scrollbars`, and scrollbars that take space are forced with a 15px `::-webkit-scrollbar`
 * (macOS's classic width); Chromium draws that only where `scrollbar-width` and `scrollbar-color`
 * are `auto`, so the app's thin scrollbars are set back to `auto` for that case.
 *
 * Usage: bun scripts/catalogue/agents-tabs.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium, type Page } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { startServer, stopServer } from "./shots.ts";

const STATE = "settings-agents";
/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;
/** A system font drawing the labels about 4% wider than Geist does here. */
const WIDER = 1.04;
const AGENTS = ["Claude Code", "Codex", "Cursor", "OpenCode", "Pi"];
/** Scrollbars that take space, as on a Mac set to show them always. */
const CLASSIC_SCROLLBARS =
	"* { scrollbar-width: auto !important; scrollbar-color: auto !important; } ::-webkit-scrollbar { width: 15px; height: 15px; background: #888; }";

interface Row {
	tabs: string[];
	scrollWidth: number;
	clientWidth: number;
	/** From the first tab's left edge to the last tab's right edge. */
	used: number;
	/** Pixels a scrollbar takes from the list, across and down: its box less its borders and inside. */
	scrollbar: { x: number; y: number };
	/** The width the Tabs root gives its rows: the page's content column. */
	panelWidth: number;
	/** Tabs whose label is cut inside the tab, or which end past the list's right edge. */
	cut: string[];
}

async function readRow(page: Page): Promise<Row> {
	return page.evaluate(() => {
		const list = document.querySelector('[role="tablist"][aria-label="Agents"]');
		const root = list?.closest("[data-orientation]:not([role])");
		if (!(list instanceof HTMLElement) || !(root instanceof HTMLElement)) {
			throw new Error("The Agents tab list or its Tabs root is not on the page.");
		}
		const style = getComputedStyle(list);
		const px = (value: string): number => Number.parseFloat(value) || 0;
		const right = list.getBoundingClientRect().right;
		const triggers = [...list.querySelectorAll('[role="tab"]')] as HTMLElement[];
		return {
			tabs: triggers.map((tab) => (tab.textContent ?? "").trim()),
			scrollWidth: list.scrollWidth,
			clientWidth: list.clientWidth,
			used:
				triggers.length === 0
					? 0
					: Math.round(
							(triggers.at(-1)?.getBoundingClientRect().right ?? 0) -
								(triggers[0]?.getBoundingClientRect().left ?? 0),
						),
			scrollbar: {
				y:
					list.offsetWidth -
					list.clientWidth -
					px(style.borderLeftWidth) -
					px(style.borderRightWidth),
				x:
					list.offsetHeight -
					list.clientHeight -
					px(style.borderTopWidth) -
					px(style.borderBottomWidth),
			},
			panelWidth: root.clientWidth,
			cut: triggers
				.filter(
					(tab) =>
						tab.scrollWidth > tab.clientWidth + 1 || tab.getBoundingClientRect().right > right + 1,
				)
				.map((tab) => (tab.textContent ?? "").trim()),
		};
	});
}

/** Every tab whole, nothing behind a sideways scroll, and no scrollbar drawn in the row. */
function fitFailure(row: Row): string | null {
	const faults: string[] = [];
	if (row.scrollWidth > row.clientWidth) {
		faults.push(`scrolls sideways (${row.scrollWidth} > ${row.clientWidth})`);
	}
	if (row.cut.length > 0) faults.push(`cuts ${row.cut.join(", ")}`);
	if (row.scrollbar.y > 0) faults.push(`a ${row.scrollbar.y}px vertical scrollbar`);
	if (row.scrollbar.x > 0) faults.push(`a ${row.scrollbar.x}px horizontal scrollbar`);
	return faults.length === 0 ? null : faults.join("; ");
}

async function open(browser: Browser, url: string, styles?: string): Promise<Page> {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	await page.clock.setFixedTime(CATALOGUE_NOW);
	const address = `${url}?${new URLSearchParams({ state: STATE, theme: "light" }).toString()}`;
	await page.goto(address, { timeout: HANG_MS });
	const html = page.locator("html[data-catalogue]");
	await html.waitFor({ state: "attached", timeout: HANG_MS });
	const status = await html.getAttribute("data-catalogue");
	if (status !== "ready") {
		throw new Error(
			`The state ${STATE} ended ${status}: ${await html.getAttribute("data-catalogue-error")}`,
		);
	}
	await page.getByRole("tablist", { name: "Agents" }).waitFor({ timeout: HANG_MS });
	if (styles !== undefined) await page.addStyleTag({ content: styles });
	return page;
}

async function main(): Promise<number> {
	const server = startServer();
	const stopOnSignal = (signal: NodeJS.Signals): void => {
		void stopServer(server.child).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
	};
	process.once("SIGINT", stopOnSignal);
	process.once("SIGTERM", stopOnSignal);
	let browser: Browser | null = null;
	let failed = 0;
	const check = (pass: boolean, message: string): void => {
		if (!pass) failed += 1;
		console.log(`${pass ? "ok  " : "FAIL"} ${message}`);
	};
	const fits = (row: Row, where: string): void => {
		const fault = fitFailure(row);
		check(
			fault === null,
			`${where}: every tab fits the row (tabs ${row.used}px, scrollWidth ${row.scrollWidth}, clientWidth ${row.clientWidth})${
				fault === null ? "" : `: ${fault}`
			}`,
		);
	};
	try {
		const url = await server.url;
		browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });

		const page = await open(browser, url);
		try {
			const atSize = await readRow(page);
			check(
				AGENTS.every((name) => atSize.tabs.includes(name)),
				`the row shows the five agents (${atSize.tabs.join(", ")})`,
			);
			fits(atSize, "labels at their own size");
			check(
				Math.abs(atSize.clientWidth - atSize.panelWidth) <= 1,
				`the tab list spans the page, as Conductor's does (list ${atSize.clientWidth}px, page ${atSize.panelWidth}px)`,
			);

			// Keyboard focus stays visible (D023): the focused tab's outline lies inside the tab list,
			// which clips whatever passes its edges.
			const outline = await page.evaluate(() => {
				const list = document.querySelector('[role="tablist"][aria-label="Agents"]');
				const tab = list?.querySelector('[role="tab"]');
				if (!(list instanceof HTMLElement) || !(tab instanceof HTMLElement)) return null;
				tab.focus();
				const style = getComputedStyle(tab);
				const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
				const box = tab.getBoundingClientRect();
				const edge = list.getBoundingClientRect();
				const inside =
					box.top - reach >= edge.top - 0.5 &&
					box.bottom + reach <= edge.bottom + 0.5 &&
					box.left - reach >= edge.left - 0.5;
				const shown = tab.matches(":focus-visible") && style.outlineStyle !== "none";
				tab.blur();
				return { inside, shown, reach };
			});
			check(
				outline?.shown === true && outline.inside,
				`a focused tab's outline shows inside the tab list (reaches ${outline?.reach ?? "?"}px past the tab)`,
			);

			// A wider system font: every label drawn 4% larger, nothing else touched.
			await page.evaluate((scale) => {
				const list = document.querySelector('[role="tablist"][aria-label="Agents"]');
				for (const tab of list?.querySelectorAll('[role="tab"]') ?? []) {
					if (!(tab instanceof HTMLElement)) continue;
					const size = Number.parseFloat(getComputedStyle(tab).fontSize);
					tab.style.fontSize = `${size * scale}px`;
				}
			}, WIDER);
			fits(await readRow(page), "labels 4% wider");

			// The instrument on a known case: a list squeezed to 200px must be reported, whether it
			// scrolls or clips.
			await page.evaluate(() => {
				const list = document.querySelector('[role="tablist"][aria-label="Agents"]');
				if (!(list instanceof HTMLElement))
					throw new Error("The Agents tab list is not on the page.");
				list.style.width = "200px";
				list.style.flex = "none";
			});
			const squeezed = await readRow(page);
			check(
				fitFailure(squeezed) !== null,
				`the check sees a row too narrow for its tabs (scrollWidth ${squeezed.scrollWidth}, clientWidth ${squeezed.clientWidth}, cut ${squeezed.cut.length})`,
			);
		} finally {
			await page.close();
		}

		// Scrollbars that take space: the case GitHub's macOS 15 runner met.
		const classic = await open(browser, url, CLASSIC_SCROLLBARS);
		try {
			fits(await readRow(classic), "scrollbars that take space");
		} finally {
			await classic.close();
		}
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
	console.log(`${failed} failures.`);
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		},
	);
}
