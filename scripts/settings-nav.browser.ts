/**
 * @feature SET-02 Settings search
 * @feature SET-02 Settings navigation
 * Owns: the browser check that the settings sidebar never scrolls sideways, and that the search
 * field keeps Conductor's size while its results open in a popover outside the sidebar.
 * Behaviour: issue #488. renderApp Jil (@11761913): the wrapper is `relative w-full min-w-0`, the
 * field is `h-7 pl-8 pr-10`, the shortcut hides while typing, and the results open in a popover.
 * jsdom has no layout, so only a browser can say `scrollWidth` equals `clientWidth`.
 * Must handle: the field at rest, a repository name long enough to push a row wider than the
 * sidebar, and the results open; every case reads the real Settings screen from the catalogue.
 * Usage: bun scripts/settings-nav.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium } from "playwright-core";
import { startServer, stopServer } from "./catalogue/shots.ts";

const HANG_MS = 60_000;

interface Measure {
	scrollWidth: number;
	clientWidth: number;
	inputWidth: number;
	inputHeight: number;
}

async function readMeasurement(page: import("playwright-core").Page): Promise<Measure> {
	return page.evaluate(() => {
		const nav = document.querySelector('nav[aria-label="Settings"]');
		const aside = nav?.closest("aside");
		const input = aside?.querySelector('input[aria-label="Search settings"]');
		if (!aside || !(input instanceof HTMLElement)) {
			throw new Error("The Settings sidebar or its search field is not on the page.");
		}
		const box = input.getBoundingClientRect();
		return {
			scrollWidth: aside.scrollWidth,
			clientWidth: aside.clientWidth,
			inputWidth: box.width,
			inputHeight: box.height,
		};
	});
}

const failures: string[] = [];

function check(condition: boolean, message: string): void {
	if (condition) {
		console.log(`ok   ${message}`);
		return;
	}
	failures.push(message);
	console.log(`FAIL ${message}`);
}

function checkNoSidewaysScroll(measure: Measure, where: string): void {
	check(
		measure.scrollWidth <= measure.clientWidth,
		`${where}: the sidebar keeps its width (scrollWidth ${measure.scrollWidth}, clientWidth ${measure.clientWidth})`,
	);
}

async function main(): Promise<number> {
	const server = startServer();
	const stopOnSignal = (signal: NodeJS.Signals): void => {
		void stopServer(server.child).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
	};
	process.once("SIGINT", stopOnSignal);
	process.once("SIGTERM", stopOnSignal);
	let browser: Browser | null = null;
	try {
		const url = await server.url;
		console.log(`Catalogue at ${url}`);
		browser = await chromium.launch();
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(`${url}?${new URLSearchParams({ state: "settings-general", theme: "light" })}`);
		await page.locator('html[data-catalogue="ready"]').waitFor({ timeout: HANG_MS });
		await page.getByRole("searchbox", { name: "Search settings" }).waitFor();

		const atRest = await readMeasurement(page);
		// The instrument on a known case: a deliberately wide child must be seen as overflow.
		const probe = await page.evaluate(() => {
			const aside = document.querySelector('nav[aria-label="Settings"]')?.closest("aside");
			if (!aside) throw new Error("The Settings sidebar is not on the page.");
			const wide = document.createElement("div");
			wide.style.width = "1000px";
			wide.dataset.probe = "overflow";
			aside.append(wide);
			const reading = { scrollWidth: aside.scrollWidth, clientWidth: aside.clientWidth };
			wide.remove();
			return reading;
		});
		check(
			probe.scrollWidth > probe.clientWidth,
			`the check sees a widened sidebar (probe scrollWidth ${probe.scrollWidth}, clientWidth ${probe.clientWidth})`,
		);
		checkNoSidewaysScroll(atRest, "at rest");
		check(
			Math.abs(atRest.inputHeight - 28) < 0.5,
			`the search field is 28px tall (measured ${atRest.inputHeight}px)`,
		);
		check(
			atRest.inputWidth <= atRest.clientWidth,
			`the search field fits the sidebar (field ${atRest.inputWidth}px, sidebar ${atRest.clientWidth}px)`,
		);

		// A repository name Conductor would truncate: widen the row without touching its classes.
		await page.evaluate(() => {
			const repo = document.querySelector("aside button[aria-expanded]");
			const name = repo?.querySelectorAll("span")[1];
			if (name) {
				name.textContent =
					"an-extremely-long-repository-name-that-would-otherwise-push-the-sidebar-wider";
			}
		});
		const longName = await readMeasurement(page);
		checkNoSidewaysScroll(longName, "with a long repository name");

		const input = page.getByRole("searchbox", { name: "Search settings" });
		await input.fill("theme");
		const list = page.locator('[aria-label="Settings search results"]');
		await list.waitFor({ timeout: HANG_MS });

		const open = await readMeasurement(page);
		checkNoSidewaysScroll(open, "with the results open");
		check((await input.inputValue()) === "theme", "typing keeps the query in the field");
		check(
			(await page.locator('[aria-label="Search settings shortcut"]').count()) === 0,
			"the shortcut hint hides while the field holds a query",
		);
		const placement = await page.evaluate(() => {
			const nav = document.querySelector('nav[aria-label="Settings"]');
			const aside = nav?.closest("aside");
			const results = document.querySelector('[aria-label="Settings search results"]');
			const input = aside?.querySelector('input[aria-label="Search settings"]');
			if (!aside || !results || !(input instanceof HTMLElement)) {
				throw new Error("The results or the search field are not on the page.");
			}
			const rows = [...results.querySelectorAll("button")];
			const visible = rows.some((row) => row.getBoundingClientRect().height > 0);
			const popover = results.parentElement ?? results;
			return {
				outsideSidebar: !aside.contains(results),
				visible,
				resultsWidth: popover.getBoundingClientRect().width,
				inputWidth: input.getBoundingClientRect().width,
			};
		});
		check(placement.outsideSidebar, "the results are a popover outside the sidebar");
		check(placement.visible, "the results are visible");
		check(
			Math.abs(placement.resultsWidth - placement.inputWidth) < 2,
			`the popover is as wide as the field (popover ${placement.resultsWidth}px, field ${placement.inputWidth}px)`,
		);

		await input.press("Escape");
		check((await input.inputValue()) === "", "Escape empties the query");
		check((await list.count()) === 0, "Escape closes the results");

		console.log(`${failures.length} failures.`);
		return failures.length === 0 ? 0 : 1;
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
}

if (import.meta.main) {
	main()
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
