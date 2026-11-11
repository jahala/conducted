/**
 * @feature Every in-app drag (issue #529)
 * Owns: the browser check that each in-app move the issue lists works with a real pointer drag in
 * the environment the app's window gives the page: the sidebar (Pinned, a section, rows, section
 * headers and project headers), the tab strip and its split panes, the follow-up queue, the
 * favourite models and a Kanban card.
 * Behaviour: Tauri's window drag-drop handler answers every HTML5 drag for file drops, so the page
 * gets a drag's `dragstart` but never its `dragover` or `drop` (the Loadout's check, issue #481).
 * Conductor's own drags are pointer driven: a press, a move past the 4px threshold, then a release
 * on the target. The sidebar's rules are ui-map.md 4; the tab's are Conductor's `targetIndex` on a
 * strip and a left/right edge or centre on a group; the queue, favourites and Kanban reorder or
 * move on the target under the pointer.
 * Must handle: the page receives no drag's `dragover` or `drop`, as in the app's window; the click
 * that ends a drag opens nothing.
 * Our design choice: the check starts the catalogue server, opens each state in Chromium and closes
 * the drag's destination events at `window` in the capture phase to stand in for Tauri's handler.
 * The pointer input is Playwright's real mouse.
 * Test first: a press that never moves stays a click.
 *
 * Usage: bun scripts/catalogue/pointer-drag.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { startServer, stopServer } from "./shots.ts";

/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;

/** The app's window keeps the drag's destination side, as Tauri's handler does. */
async function appWindow(page: Page): Promise<void> {
	await page.addInitScript(() => {
		for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
			window.addEventListener(type, (event) => event.stopImmediatePropagation(), true);
		}
	});
}

async function open(browser: Browser, url: string, state: string): Promise<Page> {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	await appWindow(page);
	const address = `${url}?${new URLSearchParams({ state, theme: "light" }).toString()}`;
	await page.clock.setFixedTime(CATALOGUE_NOW);
	await page.goto(address, { timeout: HANG_MS });
	await page.waitForFunction(
		() => document.documentElement.dataset.catalogue !== undefined,
		undefined,
		{ timeout: HANG_MS },
	);
	const html = page.locator("html");
	const status = await html.getAttribute("data-catalogue");
	if (status !== "ready") {
		throw new Error(
			`The state ${state} ended ${status}: ${await html.getAttribute("data-catalogue-error")}`,
		);
	}
	return page;
}

/** The element's text, or empty when it has gone; only a check's detail, never a pass condition. */
async function text(locator: Locator): Promise<string> {
	return locator.textContent({ timeout: 2_000 }).then(
		(value) => value ?? "",
		() => "",
	);
}

/** The point at the middle of an element. */
async function middle(element: Locator): Promise<{ x: number; y: number }> {
	const box = await element.boundingBox();
	if (box === null) throw new Error("The drag target has no box.");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses the middle of `from` and moves past the drag threshold, leaving the drag running. */
async function press(page: Page, from: Locator): Promise<void> {
	const start = await middle(from);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 8, start.y + 8, { steps: 4 });
}

/** Moves a running drag to a point and releases it. */
async function release(page: Page, to: { x: number; y: number }): Promise<void> {
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

/** A real pointer drag: press the middle of `from`, move past the threshold, release at `to`. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
	await press(page, from);
	await release(page, to);
}

/** True when the page stayed where it was, so the click that ended a drag was not also a click. */
function samePath(page: Page, path: string): boolean {
	return new URL(page.url()).pathname === path;
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

		// --- Sidebar: a row dragged to Pinned lands there, and the click opens no workspace.
		const pinned = await open(browser, url, "sidebar-drags");
		try {
			const path = new URL(pinned.url()).pathname;
			const row = pinned.locator("[data-sidebar-list] [data-workspace-id]").nth(1);
			const id = await row.getAttribute("data-workspace-id");
			await press(pinned, row);
			const target = pinned.getByRole("region", { name: "Pinned workspaces" });
			const appeared = await target.waitFor({ timeout: HANG_MS }).then(
				() => true,
				() => false,
			);
			if (!appeared) {
				check("sidebar: a row dragged to Pinned pins it", false, "Pinned never appeared");
			} else {
				await release(pinned, await middle(target));
				const landed = await target
					.locator(`[data-workspace-id="${id}"]`)
					.waitFor({ state: "attached", timeout: HANG_MS })
					.then(
						() => 1,
						() => 0,
					);
				check(
					"sidebar: a row dragged to Pinned pins it",
					landed === 1 && samePath(pinned, path),
					await text(target),
				);
			}
		} finally {
			await pinned.close();
		}

		// --- Sidebar: a row dragged into a section joins it.
		const sectioned = await open(browser, url, "sidebar-drags");
		try {
			const row = sectioned.locator("[data-sidebar-list] [data-workspace-id]").first();
			const id = await row.getAttribute("data-workspace-id");
			const section = sectioned.getByRole("region", { name: "Later" });
			await press(sectioned, row);
			const box = await section.boundingBox();
			if (box === null) throw new Error("The Later section has no box.");
			await release(sectioned, { x: box.x + box.width / 2, y: box.y + box.height - 4 });
			const landed = await section
				.locator(`[data-workspace-id="${id}"]`)
				.waitFor({ state: "attached", timeout: HANG_MS })
				.then(
					() => 1,
					() => 0,
				);
			check(
				"sidebar: a row dragged into a section joins it",
				landed === 1,
				(await section.textContent()) ?? "",
			);
		} finally {
			await sectioned.close();
		}

		// --- Sidebar: two rows in a project group reorder.
		const rows = await open(browser, url, "sidebar-drags");
		try {
			const list = rows.locator("[data-sidebar-list]");
			const order = await list
				.locator("[data-workspace-id]")
				.evaluateAll((elements) =>
					elements.map((element) => element.getAttribute("data-workspace-id") ?? ""),
				);
			const first = list.locator(`[data-workspace-id="${order[0]}"]`);
			await press(rows, first);
			const second = list.locator(`[data-workspace-id="${order[1]}"]`);
			const box = await second.boundingBox();
			if (box === null) throw new Error("The second row has no box.");
			await release(rows, { x: box.x + box.width / 2, y: box.y + box.height - 4 });
			await rows
				.waitForFunction(
					([swapped, other]) => {
						const ids = [
							...document.querySelectorAll("[data-sidebar-list] [data-workspace-id]"),
						].map((element) => element.getAttribute("data-workspace-id"));
						return ids[0] === other && ids[1] === swapped;
					},
					[order[0] ?? "", order[1] ?? ""],
					{ timeout: HANG_MS },
				)
				.catch(() => {});
			const after = await list
				.locator("[data-workspace-id]")
				.evaluateAll((elements) =>
					elements.map((element) => element.getAttribute("data-workspace-id") ?? ""),
				);
			check(
				"sidebar: two rows in a project group reorder",
				after[0] === order[1] && after[1] === order[0],
				`${order.join(",")} became ${after.join(",")}`,
			);
		} finally {
			await rows.close();
		}

		// --- Sidebar: a section header dragged onto another reorders the sections.
		const sections = await open(browser, url, "sidebar-drags");
		try {
			const waiting = sections.getByRole("region", { name: "Waiting" });
			const later = sections.getByRole("region", { name: "Later" });
			const header = waiting.getByRole("button", { name: "Waiting", exact: true });
			await press(sections, header);
			const target = later.getByRole("button", { name: "Later", exact: true });
			const box = await target.boundingBox();
			if (box === null) throw new Error("The Later header has no box.");
			await release(sections, { x: box.x + 20, y: box.y + 4 });
			const waitingBox = await waiting.boundingBox();
			const laterBox = await later.boundingBox();
			check(
				"sidebar: a section header dragged onto another reorders them",
				waitingBox !== null && laterBox !== null && waitingBox.y < laterBox.y,
				`Waiting ${waitingBox?.y ?? "?"}, Later ${laterBox?.y ?? "?"}`,
			);
		} finally {
			await sections.close();
		}

		// --- Sidebar: a project header dragged onto another reorders the projects.
		const projects = await open(browser, url, "sidebar-drags");
		try {
			const relay = projects.getByRole("region", { name: "relay" });
			const atlas = projects.getByRole("region", { name: "atlas" });
			const header = relay.getByRole("button", { name: /^relay/, exact: false }).first();
			await press(projects, header);
			const target = atlas.getByRole("button", { name: /^atlas/, exact: false }).first();
			const box = await target.boundingBox();
			if (box === null) throw new Error("The atlas header has no box.");
			await release(projects, { x: box.x + 20, y: box.y + 12 });
			const relayBox = await relay.boundingBox();
			const atlasBox = await atlas.boundingBox();
			check(
				"sidebar: a project header dragged onto another reorders the projects",
				relayBox !== null && atlasBox !== null && relayBox.y < atlasBox.y,
				`relay ${relayBox?.y ?? "?"}, atlas ${atlasBox?.y ?? "?"}`,
			);
		} finally {
			await projects.close();
		}

		// --- Tabs: a tab dragged onto another tab's left half reorders it, and opens nothing.
		const reordered = await open(browser, url, "workspace-tabs-drag");
		try {
			const strip = reordered.getByRole("tablist", { name: "Workspace tabs" });
			const selectedBefore = await strip
				.getByRole("tab", { selected: true })
				.getAttribute("aria-label");
			const second = strip.getByRole("tab", { name: "Second chat" });
			const first = strip.getByRole("tab").first();
			const box = await first.boundingBox();
			if (box === null) throw new Error("The first tab has no box.");
			await drag(reordered, second, { x: box.x + 4, y: box.y + box.height / 2 });
			const firstTitle = await strip.getByRole("tab").first().getAttribute("aria-label");
			const selectedAfter = await strip
				.getByRole("tab", { selected: true })
				.getAttribute("aria-label");
			check(
				"tabs: a tab dragged onto another's left half reorders it, and selects nothing",
				firstTitle === "Second chat" && selectedAfter === selectedBefore,
				`first is ${firstTitle ?? "?"}; selected ${selectedBefore ?? "?"} -> ${selectedAfter ?? "?"}`,
			);
		} finally {
			await reordered.close();
		}

		// --- Tabs: a tab dragged to a group's right edge splits the centre.
		const split = await open(browser, url, "workspace-tabs-drag");
		try {
			const second = split.getByRole("tab", { name: "Second chat" });
			const centre = split.getByTestId("split-centre");
			const box = await centre.boundingBox();
			if (box === null) throw new Error("The centre has no box.");
			await drag(split, second, { x: box.x + box.width - 6, y: box.y + box.height / 2 });
			const pane = await split.getByRole("region", { name: "Split pane: Second chat" }).count();
			check("tabs: a tab dragged to the right edge splits the centre", pane === 1, `${pane} panes`);
		} finally {
			await split.close();
		}

		// --- Queue: a row dragged above another reorders it.
		const queue = await open(browser, url, "chat-queue-drag");
		try {
			const rows = queue.getByRole("listbox", { name: "Queued messages" }).getByRole("option");
			const before = await rows.allTextContents();
			const third = rows.nth(2);
			const firstBox = await rows.nth(0).boundingBox();
			if (firstBox === null) throw new Error("The first queued row has no box.");
			await drag(queue, third, { x: firstBox.x + firstBox.width / 2, y: firstBox.y + 4 });
			const after = await rows.allTextContents();
			check(
				"queue: a row dragged above another reorders it",
				after[0]?.includes("Third queued message.") === true &&
					after.join("|") !== before.join("|"),
				`${before.length} rows; first is now ${after[0] ?? ""}`,
			);
		} finally {
			await queue.close();
		}

		// --- Favourites: a grip dragged onto another row moves the favourite there.
		const favourite = await open(browser, url, "composer-model-picker");
		try {
			await favourite.getByRole("button", { name: "Model picker" }).click();
			await favourite.getByRole("button", { name: "Edit", exact: true }).click();
			const grip = favourite.getByRole("button", { name: "Reorder Claude Code · haiku" });
			await press(favourite, grip);
			const target = favourite.getByRole("button", { name: "Select Codex · gpt-5.5" });
			await release(favourite, await middle(target));
			const names = await favourite
				.locator('[aria-label^="Select "]')
				.evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label") ?? ""));
			const haiku = names.findIndex((name) => name.includes("haiku"));
			const gpt = names.findIndex((name) => name.includes("gpt-5.5"));
			check(
				"favourites: a grip dragged onto another row moves the favourite there",
				haiku !== -1 && gpt !== -1 && haiku < gpt,
				names.join(", "),
			);
		} finally {
			await favourite.close();
		}

		// --- Kanban: a card dragged to another column changes its status, and opens nothing.
		const board = await open(browser, url, "dashboard");
		try {
			const sourceStatus = await (async () => {
				for (const status of ["backlog", "in_progress", "in_review", "canceled"]) {
					const region = board.getByTestId(`kanban-column-${status}`);
					if ((await region.getByTestId("kanban-card").count()) > 0) return status;
				}
				return null;
			})();
			if (sourceStatus === null) throw new Error("The board has no card to drag.");
			const card = board
				.getByTestId(`kanban-column-${sourceStatus}`)
				.getByTestId("kanban-card")
				.first();
			const id = await card.getAttribute("data-workspace-id");
			await press(board, card);
			const done = board.getByTestId("kanban-column-done");
			await done.scrollIntoViewIfNeeded();
			await release(board, await middle(done));
			const moved = await done
				.locator(`[data-workspace-id="${id}"]`)
				.waitFor({ state: "attached", timeout: HANG_MS })
				.then(
					() => 1,
					() => 0,
				);
			const stillBoard = await board.getByTestId("kanban-column-done").isVisible();
			check(
				"kanban: a card dragged to another column moves there, and opens nothing",
				moved === 1 && stillBoard,
				`${sourceStatus} -> done put ${moved} cards in Done`,
			);
		} finally {
			await board.close();
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
