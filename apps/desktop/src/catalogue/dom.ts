/**
 * @feature catalogue What an after-step does on the page, as a user would
 * Owns: finding a control by its role and accessible text, waiting a bounded number of frames for it to
 * appear, and clicking or typing into it with real DOM events, so the app's own handlers run.
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */

/** The most frames to wait for a control to appear, about five seconds at 60 frames a second. */
const MAX_FRAMES = 300;

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

const normal = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

/** The element's name as a user reads it: aria-label, else its text. */
const nameOf = (element: Element): string =>
	normal(element.getAttribute("aria-label")) || normal(element.textContent);

/** Waits for the first element matching `selector` whose name is `name` (or starts with it). */
export async function find(
	document: Document,
	selector: string,
	name: string,
	options: { prefix?: boolean } = {},
): Promise<HTMLElement> {
	for (let frame = 0; frame < MAX_FRAMES; frame++) {
		const found = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
			const text = nameOf(element);
			return options.prefix === true ? text.startsWith(name) : text === name;
		});
		if (found !== undefined) return found;
		await nextFrame();
	}
	throw new Error(`No ${selector} named "${name}" appeared.`);
}

/** Clicks like a pointer does: pointer and mouse events, then click. */
export async function click(
	document: Document,
	selector: string,
	name: string,
	options: { prefix?: boolean } = {},
): Promise<void> {
	const element = await find(document, selector, name, options);
	const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" } as const;
	element.dispatchEvent(new PointerEvent("pointerdown", init));
	element.dispatchEvent(new MouseEvent("mousedown", init));
	element.dispatchEvent(new PointerEvent("pointerup", init));
	element.dispatchEvent(new MouseEvent("mouseup", init));
	element.click();
	// A pointer click shows no focus ring; a scripted one would, so leave focus where a pointer would.
	if (document.activeElement === element) element.blur();
}

/**
 * Presses a key with nothing focused, as after clicking an empty part of the window. Returns whether
 * the app took the key (its handler prevented the default).
 */
export function press(
	document: Document,
	key: string,
	modifiers: { meta?: boolean } = {},
): boolean {
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	const target = document.body;
	const init = { key, bubbles: true, cancelable: true, metaKey: modifiers.meta === true };
	const down = new KeyboardEvent("keydown", init);
	target.dispatchEvent(down);
	target.dispatchEvent(new KeyboardEvent("keyup", init));
	return down.defaultPrevented;
}

/** True when the page shows `text` anywhere. */
export const shows = (document: Document, text: string): boolean =>
	document.body.textContent?.includes(text) === true;

/**
 * Presses a shortcut until the app takes it, one try a frame. The key listener reads the user's key
 * bindings, which load a moment after the screen first draws.
 */
export async function pressUntilTaken(
	document: Document,
	key: string,
	modifiers: { meta?: boolean } = {},
): Promise<void> {
	for (let frame = 0; frame < MAX_FRAMES; frame++) {
		if (press(document, key, modifiers)) return;
		await nextFrame();
	}
	throw new Error(`The app never took the key ${modifiers.meta === true ? "Cmd+" : ""}${key}.`);
}
