/**
 * @feature catalogue When a catalogue state counts as settled
 * Owns: the bounded waits the state mount uses: for a condition, for the page to stop changing, and
 * the whole settle (the app idle, the state's ready check holding, the page quiet).
 * Behaviour: docs/engineering.md, "States catalogue". "Settled" means the router is idle, no query or
 * mutation is running, the state's own `ready` check holds, and the page has not changed for ten
 * animation frames in a row.
 * Must handle: every wait is bounded by frames, so a state that never settles fails with the reason
 * instead of hanging the screenshot run; a ready check that held once and no longer holds once the
 * page is quiet fails the state, since the picture would not show what the state is about.
 * Test first: a ready check that holds, then stops holding before the page goes quiet, fails the
 * settle with the state's id.
 */

/** Frames the page must stay unchanged before it counts as settled. */
const QUIET_FRAMES = 10;
/** The most frames any wait may take, about twenty seconds at 60 frames a second. */
export const MAX_FRAMES = 1_200;

export const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits, one frame at a time, until `holds` is true. Fails with `what` after MAX_FRAMES. */
export async function waitFor(what: string, holds: () => boolean): Promise<void> {
	for (let frame = 0; frame < MAX_FRAMES; frame++) {
		if (holds()) return;
		await nextFrame();
	}
	throw new Error(`The screen never settled: ${what}.`);
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
		for (let frame = 0; frame < MAX_FRAMES; frame++) {
			await nextFrame();
			quiet = changed ? 0 : quiet + 1;
			changed = false;
			if (quiet >= QUIET_FRAMES) return;
		}
		throw new Error("The screen never settled: the page kept changing.");
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
