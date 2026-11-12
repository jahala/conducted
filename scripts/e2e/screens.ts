/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: reaching a screen of the real app the way a person does: a settings page through the
 * sidebar's Settings link and the settings navigation, a project's settings page through its entry
 * in that navigation, and a workspace through a `conducted://workspace` link.
 * Behaviour: features/settings/SettingsNav.tsx (the user pages by title, each project's pages
 * under its entry), app/deep-link-routes.ts (NAV-17: `conducted://workspace?id=` opens the
 * workspace, as a notification click does).
 * Must handle: a page that is already open (its link is clicked again, which changes nothing); a
 * screen that never appears (a named failure after the hang limit).
 * Our design choice: a workspace opens through its link because a cloud workspace is listed only
 * under its Worker in the sidebar's organisation switcher, and pairing needs a Worker on the
 * network. The link takes the path the shell's deep-link handler hands the UI (`app://deep-link`).
 */
import { type Browser, until } from "./harness.ts";

const NAV = 'nav[aria-label="Settings"]';

/** Clicks the first element `selector` finds whose text is `text`. */
async function clickByText(browser: Browser, selector: string, text: string): Promise<void> {
	const element = await until(`"${text}" in ${selector}`, async () => {
		for (const candidate of await browser.$$(selector)) {
			if ((await candidate.getText()).trim() === text) return candidate;
		}
		return undefined;
	});
	await element.click();
}

/** Waits until the page's path is `path`. */
async function at(browser: Browser, what: string, test: (path: string) => boolean): Promise<void> {
	await until(what, async () =>
		test(await browser.execute(() => location.pathname)) ? true : undefined,
	);
}

async function openSettings(browser: Browser): Promise<void> {
	if ((await browser.$$(NAV)).length > 0) return;
	const link = await until("the sidebar's Settings link", async () => {
		const found = await browser.$$('a[aria-label="Settings"]');
		return found.length > 0 ? found[0] : undefined;
	});
	await link.click();
	await until("the settings navigation", async () =>
		(await browser.$$(NAV)).length > 0 ? true : undefined,
	);
}

/** Opens one of the user's settings pages by its id and title (settings-pages.ts). */
export async function openUserSettings(browser: Browser, id: string, title: string): Promise<void> {
	await openSettings(browser);
	await clickByText(browser, `${NAV} button`, title);
	await at(browser, `the ${title} settings page`, (path) => path === `/settings/user/${id}`);
}

/** Opens one of a project's settings pages: its entry in the navigation, then the page. */
export async function openRepoSettings(
	browser: Browser,
	repo: { id: string; name: string },
	page: { id: string; title: string },
): Promise<void> {
	await openSettings(browser);
	const entry = `${NAV} button[aria-expanded]`;
	const expanded = await browser.execute(
		(selector: string, name: string) =>
			[...document.querySelectorAll(selector)].some(
				(button) =>
					button.textContent?.includes(name) === true &&
					button.getAttribute("aria-expanded") === "true",
			),
		entry,
		repo.name,
	);
	if (!expanded) {
		const element = await until(`the ${repo.name} entry in the settings navigation`, async () => {
			for (const candidate of await browser.$$(entry)) {
				if ((await candidate.getText()).includes(repo.name)) return candidate;
			}
			return undefined;
		});
		await element.click();
		await at(browser, `${repo.name}'s settings`, (path) =>
			path.startsWith(`/settings/repos/${repo.id}/`),
		);
	}
	await clickByText(browser, `${NAV} button[aria-expanded="true"] + div button`, page.title);
	await at(
		browser,
		`${repo.name}'s ${page.title} settings page`,
		(path) => path === `/settings/repos/${repo.id}/${page.id}`,
	);
}

/** Opens a workspace through its `conducted://workspace` link. */
export async function openWorkspaceByLink(browser: Browser, workspaceId: string): Promise<void> {
	await browser.execute((link: string) => {
		const internals = (
			window as unknown as {
				__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
			}
		).__TAURI_INTERNALS__;
		void internals.invoke("plugin:event|emit", { event: "app://deep-link", payload: link });
	}, `conducted://workspace?id=${workspaceId}`);
	await at(browser, `workspace ${workspaceId}`, (path) =>
		path.endsWith(`/workspace/${workspaceId}`),
	);
}
