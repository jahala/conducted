/**
 * @feature catalogue The states catalogue entry
 * Owns: `catalogue.html`. Without a `state` in the address it draws the index page, which links every
 * state in light and dark. With `?state=<id>&theme=<light|dark>` it builds that state's world, seeds it,
 * mounts the real app entry (`startApp` from main.tsx: the real providers, router and screens) on the
 * in-memory Platform at the state's route, runs the state's after-step and waits for the screen to
 * settle. It then marks <html> with `data-catalogue="ready"` (or `"failed"` with the reason in
 * `data-catalogue-error`) and the app route in `data-catalogue-route`, which the screenshot run reads.
 * Behaviour: docs/plans/parallel-build.md section 2, "States catalogue". Run it with
 * `pnpm --dir apps/desktop catalogue`; docs/engineering.md says how.
 * Our design choice: "settled" means the start-up finished, the fonts are loaded, and settle.ts holds:
 * the router is idle, no query or mutation is running, the state's own `ready` check holds, the page
 * has not changed for ten animation frames in a row, and the ready check still holds then. Every
 * wait is bounded by frames, so a state that never settles fails with a reason instead of hanging.
 * Must handle: an unknown state id (the index page with a notice); a seed or after-step that throws
 * (marked failed, with the message on screen); the release build never includes this file
 * (scripts/catalogue/check-bundle.ts fails the build if it does).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startApp } from "../main.tsx";
import { CatalogueIndex } from "./CatalogueIndex.tsx";
import { CATALOGUE_MARKER } from "./marker.ts";
import { setSetting } from "./seeds.ts";
import { MAX_FRAMES, nextFrame, settle, waitFor } from "./settle.ts";
import { openCatalogueDatabase } from "./sqlite.ts";
import type { CatalogueState, Theme } from "./state.ts";
import { CATALOGUE_STATES } from "./states/index.ts";
import { createWorld } from "./world.ts";

/** Fails with `what` when `work` has not finished after MAX_FRAMES frames. */
async function withinFrames<T>(what: string, work: Promise<T>): Promise<T> {
	let finished = false;
	const timeout = (async (): Promise<never> => {
		for (let frame = 0; frame < MAX_FRAMES && !finished; frame++) await nextFrame();
		throw new Error(`The screen never settled: ${what} did not finish.`);
	})();
	try {
		return await Promise.race([work, timeout]);
	} finally {
		finished = true;
		timeout.catch(() => {});
	}
}

function mark(status: "ready" | "failed", detail: { route?: string; error?: string }): void {
	const html = document.documentElement;
	if (detail.route !== undefined) html.dataset.catalogueRoute = detail.route;
	if (detail.error !== undefined) html.dataset.catalogueError = detail.error;
	html.dataset.catalogue = status;
}

async function mountState(
	element: HTMLElement,
	state: CatalogueState,
	theme: Theme,
): Promise<void> {
	const world = createWorld(await openCatalogueDatabase());
	await setSetting(world, "theme", theme);
	const scene = await state.seed(world);
	const app = startApp({
		root: element,
		platform: world.memory.platform,
		clock: world.clock,
		ids: world.ids,
		history: createMemoryHistory({ initialEntries: [scene.route] }),
	});
	if ((scene.start ?? "ready") === "ready") {
		const started = await app.started;
		if (!started.ok) throw new Error(`The app did not start: ${started.error.message}`);
	}
	const activity = {
		routerIdle: () => app.router.state.status === "idle",
		queriesIdle: () => app.queryClient.isFetching() === 0 && app.queryClient.isMutating() === 0,
	};
	await waitFor("the router is loading", activity.routerIdle);
	if (scene.after !== undefined) {
		await withinFrames("the state's after-step", scene.after({ world, app, document }));
	}
	await document.fonts.ready;
	await settle(state.id, scene.ready, activity);
	const location = app.router.state.location;
	mark("ready", { route: `${location.pathname}${location.searchStr}` });
}

function showFailure(element: HTMLElement, state: CatalogueState, message: string): void {
	const notice = document.createElement("pre");
	notice.textContent = `Catalogue state "${state.id}" failed.\n\n${message}`;
	notice.className =
		"fixed inset-x-4 bottom-4 z-[99999] whitespace-pre-wrap rounded-md border border-danger " +
		"bg-surface p-3 font-mono text-xs text-danger shadow-popover";
	element.ownerDocument.body.appendChild(notice);
}

function main(): void {
	const element = document.getElementById("catalogue");
	if (element === null) return;
	document.documentElement.dataset.catalogueMarker = CATALOGUE_MARKER;
	const params = new URLSearchParams(window.location.search);
	const stateId = params.get("state");
	const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
	const state = CATALOGUE_STATES.find((candidate) => candidate.id === stateId);
	if (state === undefined) {
		createRoot(element).render(
			<StrictMode>
				<CatalogueIndex states={CATALOGUE_STATES} unknownId={stateId} />
			</StrictMode>,
		);
		return;
	}
	document.title = `${state.id} (${theme}) · Conducted catalogue`;
	mountState(element, state, theme).catch((cause: unknown) => {
		const message = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
		showFailure(element, state, message);
		mark("failed", { error: message });
	});
}

main();
