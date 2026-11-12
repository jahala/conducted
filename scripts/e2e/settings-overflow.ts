/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: the check that no settings page scrolls sideways in the real window: on every user page
 * and every page of each project, nothing reaches past the window's right edge, and no box that
 * can scroll holds content wider than itself.
 * Behaviour: #488 and #531 (the settings sidebar scrolled sideways; jsdom has no layout, so only a
 * real window can measure it); issue #564 ("on each settings page, no element is wider than its
 * window"). The check fails on the commit before #531's fix and passes after it.
 * Must handle: a project name longer than its row (the world seeds one); the settings search with
 * its results open; a text field, whose own text may scroll inside it by design (not counted).
 * The instrument is proved on a known case first: a box wider than the settings sidebar, put in
 * it for one reading, must be reported.
 * Our design choice: the window is set to the app's default size (tauri.conf.json) before anything is
 * measured, so a runner whose screen gives a smaller window cannot report a narrow window's overflow
 * as a fault; a screen that cannot hold the default size fails the check and says so.
 * Our design choice: a box "can scroll" when its computed `overflow-x` is `auto` or `scroll`. CSS
 * computes `visible` to `auto` when the other axis scrolls, so a sidebar that scrolls up and down
 * counts, as the one #488 found did. An element hidden by a clipping parent is not past the edge.
 */

import {
	REPO_SETTINGS_PAGES,
	USER_SETTINGS_PAGES,
} from "../../apps/desktop/src/features/settings/settings-pages.ts";
import appConfig from "../../apps/desktop/src-tauri/tauri.conf.json" with { type: "json" };
import { type Browser, type Check, HANG_MS, until } from "./harness.ts";
import { openRepoSettings, openUserSettings } from "./screens.ts";
import { startInWorld } from "./world.ts";

/** Measures the page now. Each line names one element that scrolls sideways or passes the edge. */
export async function sidewaysOverflow(browser: Browser): Promise<string[]> {
	return await browser.execute(() => {
		const name = (element: Element): string => {
			const label = element.getAttribute("aria-label");
			const id = element.id === "" ? "" : `#${element.id}`;
			const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
			return `<${element.tagName.toLowerCase()}${id}${label === null ? "" : ` "${label}"`}> "${text}"`;
		};
		const scrolls = (element: Element): boolean => {
			const overflow = getComputedStyle(element).overflowX;
			return overflow === "auto" || overflow === "scroll";
		};
		const clips = (element: Element): boolean => getComputedStyle(element).overflowX !== "visible";
		const width = document.documentElement.clientWidth;
		const found: string[] = [];
		if (document.documentElement.scrollWidth > width) {
			found.push(
				`the window scrolls sideways (${document.documentElement.scrollWidth} > ${width})`,
			);
		}
		for (const element of document.body.querySelectorAll("*")) {
			if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) continue;
			if (scrolls(element) && element.scrollWidth > element.clientWidth + 1) {
				found.push(
					`${name(element)} scrolls sideways (${element.scrollWidth} > ${element.clientWidth})`,
				);
				continue;
			}
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 || rect.right <= width + 1) continue;
			let clipped = false;
			for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
				if (clips(parent) && parent.getBoundingClientRect().right <= width + 1) {
					clipped = true;
					break;
				}
			}
			if (!clipped)
				found.push(
					`${name(element)} reaches past the window (${Math.round(rect.right)} > ${width})`,
				);
		}
		return found;
	});
}

/** The instrument on a known case: a box wider than the settings sidebar must be reported. */
async function provesWideBox(browser: Browser): Promise<boolean> {
	await browser.execute(() => {
		const aside = document.querySelector('nav[aria-label="Settings"]')?.closest("aside");
		const wide = document.createElement("div");
		wide.dataset.e2eProbe = "overflow";
		wide.style.width = "1000px";
		wide.style.height = "1px";
		aside?.append(wide);
	});
	const seen = await sidewaysOverflow(browser);
	await browser.execute(() => document.querySelector('[data-e2e-probe="overflow"]')?.remove());
	return seen.length > 0;
}

export const settingsOverflow: Check = {
	name: "no settings page scrolls sideways in the real window",
	async run(context) {
		const { app, world } = await startInWorld(context);
		const browser = app.browser;
		// The app's default window: what a new install opens with.
		const size = appConfig.app.windows[0];
		if (size === undefined) return ["tauri.conf.json names no window"];
		await browser.setWindowRect(0, 0, size.width, size.height);
		const width = await browser.execute(() => window.innerWidth);
		if (width < size.width) {
			return [
				`the screen holds a window only ${width}px wide; this check measures at the app's default ${size.width}px`,
			];
		}
		const failures: string[] = [];
		const report = async (where: string): Promise<void> => {
			for (const line of await sidewaysOverflow(browser)) failures.push(`${where}: ${line}`);
		};
		const first = USER_SETTINGS_PAGES[0];
		if (first === undefined) return ["there are no settings pages"];
		await openUserSettings(browser, first.id, first.title);
		if (!(await provesWideBox(browser))) {
			return ["the measurement missed a box 1000px wide in the settings sidebar"];
		}
		for (const page of USER_SETTINGS_PAGES) {
			await openUserSettings(browser, page.id, page.title);
			await report(page.id);
		}
		for (const project of world.projects) {
			for (const page of REPO_SETTINGS_PAGES) {
				await openRepoSettings(browser, project, page);
				await report(`${project.name}/${page.id}`);
			}
		}
		const search = await until("the settings search field", async () => {
			const found = await browser.$$('input[aria-label="Search settings"]');
			return found.length > 0 ? found[0] : undefined;
		});
		await search.click();
		await search.addValue("theme");
		// The results list is measured once it shows. Older builds filtered in place and have no
		// list; their page is measured with the query typed, which is what a person sees there.
		const listed = await until(
			"the settings search results",
			async () =>
				(await browser.$$('[aria-label="Settings search results"]')).length > 0 ? true : undefined,
			HANG_MS / 12,
		).catch(() => false);
		await report(listed ? "search results open" : "search typed");
		return failures;
	},
};
