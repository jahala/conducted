/**
 * @feature catalogue The shape of one catalogue state
 * Owns: what a state declares (its id, its group and title on the index page, its seed, and what it does
 * once the app is up) and the context the seed and the after-step receive.
 * Behaviour: docs/plans/parallel-build.md section 2, "States catalogue": every view registers its designed
 * states once, and the same list drives the browsable catalogue and the screenshots.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { StartedApp } from "../main.tsx";
import type { World } from "./world.ts";

export type Theme = "light" | "dark";

export interface CatalogueState {
	/** Short and stable: it names the screenshot file. Lowercase words joined by hyphens. */
	id: string;
	/** The heading the index page lists it under. */
	group: string;
	title: string;
	/** Writes what the screen needs before the app starts, and says what to open. */
	seed(world: World): Promise<Scene>;
}

/** What a seeded state opens, and what it does once the app is up. */
export interface Scene {
	/** The app route to open. */
	route: string;
	/**
	 * Runs once the app has started and the route has loaded: deliver sidecar lines, open a menu, type
	 * into the composer. Returns when the step is done; the page then waits for the screen to settle.
	 */
	after?(context: AfterContext): Promise<void>;
	/** True once the screen shows what the state is about. Checked on every frame until it holds. */
	ready?(document: Document): boolean;
}

export interface AfterContext {
	world: World;
	app: StartedApp;
	document: Document;
}
