/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: the check that a drag in the real window lands: a workspace dragged from its project in
 * the sidebar onto Pinned is pinned there.
 * Behaviour: #529 and #539 (every in-app drag was dead in the app's window, though jsdom and
 * Chromium passed); ui-map.md 4 (a row dragged to Pinned pins it; Pinned shows while a drag runs).
 * The check fails on the commit before #539's fix and passes after it.
 * Must handle: the project's group starts closed (it is opened by a click first); Pinned appears
 * only once a drag runs, so the drag is held until it shows; the click that ends a drag opens no
 * workspace.
 * Our design choice: the pointer is the WebDriver server's (W3C actions): a press, a move past the
 * 4px threshold, then a move onto Pinned and a release. The server in the app dispatches these as
 * pointer and mouse events in the page; it does not move the Mac's real cursor, so macOS's own
 * drag session, which Tauri's handler answers, is not started by them.
 */
import { type Browser, type Check, HANG_MS, until } from "./harness.ts";
import { startInWorld } from "./world.ts";

interface Box {
	x: number;
	y: number;
}

/** The middle of the first element `selector` finds, in the window's CSS pixels. */
async function middle(browser: Browser, selector: string): Promise<Box | null> {
	return await browser.execute((query: string) => {
		const element = document.querySelector(query);
		if (element === null) return null;
		element.scrollIntoView({ block: "nearest" });
		const rect = element.getBoundingClientRect();
		return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
	}, selector);
}

/** Opens the project's group in the sidebar so its workspace rows show. */
async function openProject(browser: Browser, name: string, row: string): Promise<void> {
	if ((await browser.$$(row)).length > 0) return;
	// The group's header is a disclosure button; one of its parts is the project's name.
	const header = await until(`the ${name} group in the sidebar`, async () => {
		const index = await browser.execute(
			(project: string) =>
				[...document.querySelectorAll('button[aria-expanded="false"]')].findIndex((button) =>
					[...button.querySelectorAll("*")].some((part) => part.textContent?.trim() === project),
				),
			name,
		);
		return index < 0 ? undefined : (await browser.$$('button[aria-expanded="false"]'))[index];
	});
	await header.click();
	await until(`the ${name} group's rows`, async () =>
		(await browser.$$(row)).length > 0 ? true : undefined,
	);
}

export const sidebarDrag: Check = {
	name: "a workspace dragged onto Pinned in the real window is pinned",
	async run(context) {
		const { app, world } = await startInWorld(context);
		const browser = app.browser;
		const project = world.projects[0];
		const workspace = world.local[1];
		if (project === undefined || workspace === undefined) return ["the world has no workspace"];
		const row = `[data-sidebar-list] [data-workspace-id="${workspace.id}"]`;
		await openProject(browser, project.name, row);
		const path = await browser.execute(() => location.pathname);
		const from = await middle(browser, row);
		if (from === null) return [`the row of ${workspace.branch} is not in the sidebar`];

		await browser
			.action("pointer", { parameters: { pointerType: "mouse" } })
			.move({ x: from.x, y: from.y })
			.down()
			.move({ x: from.x + 4, y: from.y + 4, duration: 50 })
			.move({ x: from.x + 8, y: from.y + 8, duration: 50 })
			.perform(true);
		const pinned = '[aria-label="Pinned workspaces"]';
		const target = await until(
			"Pinned to show while the drag runs",
			async () => (await middle(browser, pinned)) ?? undefined,
			HANG_MS / 4,
		).catch(() => null);
		if (target === null) {
			await browser.releaseActions();
			return [
				`dragging ${workspace.branch} showed no Pinned target: the drag never started in the window`,
			];
		}
		await browser
			.action("pointer", { parameters: { pointerType: "mouse" } })
			.move({ x: target.x, y: target.y, duration: 100 })
			.up()
			.perform();

		const failures: string[] = [];
		const landed = await until(
			`${workspace.branch} in Pinned`,
			async () =>
				(await browser.$$(`${pinned} [data-workspace-id="${workspace.id}"]`)).length > 0
					? true
					: undefined,
			HANG_MS / 4,
		).catch(() => false);
		if (!landed) {
			const shown = await browser.execute(
				(query: string) => document.querySelector(query)?.textContent ?? "(no Pinned)",
				pinned,
			);
			failures.push(
				`${workspace.branch} was released on Pinned but is not in it (Pinned shows "${shown}")`,
			);
		}
		const after = await browser.execute(() => location.pathname);
		if (after !== path) failures.push(`the click that ended the drag opened ${after}`);
		return failures;
	},
};
