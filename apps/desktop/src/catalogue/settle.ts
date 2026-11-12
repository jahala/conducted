/**
 * @feature catalogue When a catalogue state counts as settled
 * Owns: the bounded waits the state mount uses: for a condition, for the page to stop changing, and
 * the whole settle (the app idle, the state's ready check holding, the page quiet).
 * Behaviour: docs/engineering.md, "States catalogue". "Settled" means the router is idle, no query or
 * mutation is running, the state's own `ready` check holds, and the page has not changed for ten
 * animation frames in a row.
 * Must handle: every wait is bounded by HANG_MS of time, so a state that never settles fails with the
 * reason instead of hanging the screenshot run, while a busy runner that draws frames slowly still
 * settles; a ready check that held once and no longer holds once the
 * page is quiet fails the state, since the picture would not show what the state is about.
 * Test first: a ready check that holds, then stops holding before the page goes quiet, fails the
 * settle with the state's id.
 */

/** Frames the page must stay unchanged before it counts as settled. */
const QUIET_FRAMES = 10;
/**
 * The longest any one wait may take. It is sized to catch a hang: a busy CI runner draws frames
 * slowly or late, and that slowness must still pass. Every wait in the catalogue uses it. It stays
 * well under the screenshot run's own 60-second wait for a page, so a state that hangs fails here,
 * with its reason.
 */
export const HANG_MS = 20_000;

export const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Calls `get` once a frame until it returns a value, and returns that value. Returns undefined when
 * `limitMs` pass first.
 */
export async function poll<T>(
	get: () => T | undefined,
	limitMs: number = HANG_MS,
): Promise<T | undefined> {
	const deadline = performance.now() + limitMs;
	for (;;) {
		const value = get();
		if (value !== undefined) return value;
		if (performance.now() >= deadline) return undefined;
		await nextFrame();
	}
}

/** Waits, one frame at a time, until `holds` is true. Fails with `what` after HANG_MS. */
export async function waitFor(what: string, holds: () => boolean): Promise<void> {
	const held = await poll(() => (holds() ? true : undefined));
	if (held === undefined) throw new Error(`The screen never settled: ${what}.`);
}

/** Waits until nothing on the page changed for QUIET_FRAMES frames in a row. */
export async function waitForQuiet(root: Node): Promise<void> {
	let changed = true;
	const observer = new MutationObserver(() => {
		changed = true;
	});
	observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
	try {
		let quiet = 0;
		const settled = await poll(() => {
			quiet = changed ? 0 : quiet + 1;
			changed = false;
			return quiet >= QUIET_FRAMES ? true : undefined;
		});
		if (settled === undefined) throw new Error("The screen never settled: the page kept changing.");
	} finally {
		observer.disconnect();
	}
}

/** What settling needs to know about the running app. */
export interface AppActivity {
	routerIdle(): boolean;
	/** True when no query or mutation is running. */
	queriesIdle(): boolean;
}

export async function settle(
	id: string,
	ready: ((document: Document) => boolean) | undefined,
	app: AppActivity,
): Promise<void> {
	await waitFor("the router is loading", app.routerIdle);
	await waitFor("a query or mutation is still running", app.queriesIdle);
	if (ready !== undefined) {
		await waitFor(`"${id}" never showed what it is about`, () => ready(document));
	}
	await waitForQuiet(document.body);
	await waitFor("a query or mutation started while the page settled", app.queriesIdle);
	// A menu the after-step opened can close a moment after the check first held, when the app
	// moves the focus. The picture would then lack what the state is about, so the state fails.
	if (ready !== undefined && !ready(document)) {
		throw new Error(
			`The screen never settled: "${id}" showed what it is about, then lost it before the page went quiet.`,
		);
	}
}
