/**
 * @feature catalogue What an after-step does on the page, as a user would
 * Owns: finding a control by its role and accessible text, waiting for it to appear (up to the
 * catalogue's hang limit, HANG_MS in settle.ts), and clicking, pointing at, typing into or pressing
 * keys in it with real DOM events (Cmd, Alt and Shift modifiers included), so the app's own handlers run.
 * Our design choice: each of those acts once the page has gone quiet, as a user acts on a loaded
 * screen. Until then the app may still move the focus (the composer takes it once it has loaded),
 * which would close a menu the step just opened. `find` and the `...On` helpers do not wait.
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */

import { poll, waitForQuiet } from "./settle.ts";

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
	const found = await poll(() =>
		[...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
			const text = nameOf(element);
			return options.prefix === true ? text.startsWith(name) : text === name;
		}),
	);
	if (found === undefined) throw new Error(`No ${selector} named "${name}" appeared.`);
	return found;
}

/** Waits for the first element matching `selector`, for a target with no name of its own. */
export async function findFirst(document: Document, selector: string): Promise<HTMLElement> {
	const found = await poll(() => document.querySelector<HTMLElement>(selector) ?? undefined);
	if (found === undefined) throw new Error(`No ${selector} appeared.`);
	return found;
}

/** Waits for the control named `name`, then clicks it as a pointer does. */
export async function click(
	document: Document,
	selector: string,
	name: string,
	options: { prefix?: boolean } = {},
): Promise<void> {
	await waitForQuiet(document.body);
	clickOn(await find(document, selector, name, options));
}

/** Clicks `element` like a pointer does: pointer and mouse events, then click. */
export function clickOn(element: HTMLElement): void {
	const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" } as const;
	element.dispatchEvent(new PointerEvent("pointerdown", init));
	element.dispatchEvent(new MouseEvent("mousedown", init));
	element.dispatchEvent(new PointerEvent("pointerup", init));
	element.dispatchEvent(new MouseEvent("mouseup", init));
	// A pointer click counts 1; `element.click()` counts 0, which controls read as the keyboard.
	element.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
	// A pointer click shows no focus ring; a scripted one would, so leave focus where a pointer would.
	if (element.ownerDocument.activeElement === element) element.blur();
}

/** Waits for the control named `name`, then right-clicks it as a pointer does. */
export async function rightClick(
	document: Document,
	selector: string,
	name: string,
	options: { prefix?: boolean } = {},
): Promise<void> {
	await waitForQuiet(document.body);
	rightClickOn(await find(document, selector, name, options));
}

/** Right-clicks `element` like a pointer does, which opens its context menu. */
export function rightClickOn(element: HTMLElement): void {
	const box = element.getBoundingClientRect();
	const init = {
		bubbles: true,
		cancelable: true,
		button: 2,
		clientX: box.left + box.width / 2,
		clientY: box.top + box.height / 2,
	} as const;
	element.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
	element.dispatchEvent(new MouseEvent("contextmenu", init));
}

/**
 * Presses a key as a user does. With `at`, the key goes to the first element matching that selector,
 * focused as after clicking into it; without it, nothing has focus, as after clicking an empty part
 * of the window. Returns whether the app took the key (its handler prevented the default); false
 * while the element `at` names is not on the page.
 */
export function press(
	document: Document,
	key: string,
	modifiers: { meta?: boolean; alt?: boolean; shift?: boolean } = {},
	at?: string,
): boolean {
	let target: HTMLElement = document.body;
	if (at === undefined) {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	} else {
		const found = document.querySelector<HTMLElement>(at);
		if (found === null) return false;
		found.focus();
		target = found;
	}
	const init = {
		key,
		bubbles: true,
		cancelable: true,
		metaKey: modifiers.meta === true,
		altKey: modifiers.alt === true,
		shiftKey: modifiers.shift === true,
	};
	const down = new KeyboardEvent("keydown", init);
	target.dispatchEvent(down);
	target.dispatchEvent(new KeyboardEvent("keyup", init));
	return down.defaultPrevented;
}

/**
 * Types into a text field as a user does: sets the value through the element's own setter, so React sees
 * the change, then fires the input event.
 */
export async function typeInto(
	document: Document,
	selector: string,
	name: string,
	text: string,
): Promise<void> {
	await waitForQuiet(document.body);
	const element = await find(document, selector, name);
	if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
		throw new Error(`${selector} named "${name}" is not a text field.`);
	}
	fillIn(element, text);
}

/** Waits for the first text field matching `selector`, for a field with no name of its own. */
export async function findField(
	document: Document,
	selector: string,
): Promise<HTMLInputElement | HTMLTextAreaElement> {
	const found = await findFirst(document, selector);
	if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) {
		throw new Error(`${selector} is not a text field.`);
	}
	return found;
}

/** Types into a text field found another way, such as a field with no name of its own. */
export function fillIn(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	const prototype = Object.getPrototypeOf(element) as object;
	const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
	element.focus();
	setter?.call(element, text);
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Points the pointer at the first element matching `selector` named `name`, as a pointer moving onto
 * it does: over, enter, then a move. A hover card opens on enter; a tooltip opens on the move.
 */
export async function hover(
	document: Document,
	selector: string,
	name: string,
	options: { prefix?: boolean } = {},
): Promise<void> {
	await waitForQuiet(document.body);
	const element = await find(document, selector, name, options);
	const init = { bubbles: true, cancelable: true, pointerType: "mouse" } as const;
	element.dispatchEvent(new PointerEvent("pointerover", init));
	element.dispatchEvent(new PointerEvent("pointerenter", init));
	element.dispatchEvent(new MouseEvent("mouseover", init));
	element.dispatchEvent(new MouseEvent("mouseenter", init));
	element.dispatchEvent(new PointerEvent("pointermove", init));
	element.dispatchEvent(new MouseEvent("mousemove", init));
}

/** True when an element matching `selector` is named `name`: an icon button counts by its aria-label. */
export const has = (document: Document, selector: string, name: string): boolean =>
	[...document.querySelectorAll(selector)].some((element) => nameOf(element) === name);

/** True when the page shows `text` anywhere. */
export const shows = (document: Document, text: string): boolean =>
	document.body.textContent?.includes(text) === true;

/**
 * Presses a shortcut until the app takes it, one try a frame. The key listener reads the user's key
 * bindings, which load a moment after the screen first draws. `at` is as in `press`: a key that
 * belongs to one area (Cmd+F in the file editor) is pressed with that area focused.
 */
export async function pressUntilTaken(
	document: Document,
	key: string,
	modifiers: { meta?: boolean; alt?: boolean; shift?: boolean } = {},
	at?: string,
): Promise<void> {
	await waitForQuiet(document.body);
	const taken = await poll(() => (press(document, key, modifiers, at) ? true : undefined));
	if (taken !== undefined) return;
	const chord = `${modifiers.meta === true ? "Cmd+" : ""}${modifiers.alt === true ? "Alt+" : ""}${modifiers.shift === true ? "Shift+" : ""}`;
	const where = at === undefined ? "" : ` in ${at}`;
	throw new Error(`The app never took the key ${chord}${key}${where}.`);
}
