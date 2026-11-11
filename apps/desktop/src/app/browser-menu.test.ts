/**
 * @feature APP-01 Browser menu guard
 * Owns: the cases the document-level browser-menu listeners handle, as Conductor's Acs and Tcs do.
 * Behaviour: renderApp Acs and Tcs (Conductor 0.92.1); issue #495.
 * Must handle: a link, a button and empty space; an input, a textarea and a contenteditable field; an
 * image and the code editor; modifier-click and middle-click on a link.
 * Test first: a right-click on a plain link blocks the browser menu.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBrowserMenuGuard } from "./browser-menu.ts";

let dispose: () => void;

beforeEach(() => {
	document.body.innerHTML = "";
	dispose = installBrowserMenuGuard();
});

afterEach(() => {
	dispose();
	document.body.innerHTML = "";
});

/** Whether the document-level listener stopped the event's default action. */
function prevented(target: EventTarget, init: MouseEventInit = {}): boolean {
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
	return event.defaultPrevented;
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	parent: HTMLElement = document.body,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	parent.append(node);
	return node;
}

describe("APP-01 browser menu guard", () => {
	it("blocks the browser menu on a sidebar link, a button and empty space", () => {
		expect(prevented(element("a"))).toBe(true);
		expect(prevented(element("button"))).toBe(true);
		expect(prevented(element("div"))).toBe(true);
	});

	it("keeps the system text menu in an input, a textarea and a contenteditable field", () => {
		const input = element("input");
		const textarea = element("textarea");
		const editable = element("div");
		editable.setAttribute("contenteditable", "true");
		const inside = element("span", editable);

		expect(prevented(input)).toBe(false);
		expect(prevented(textarea)).toBe(false);
		expect(prevented(editable)).toBe(false);
		expect(prevented(inside)).toBe(false);
	});

	it("blocks the browser menu on an image and inside the code editor", () => {
		const image = element("img");
		const editor = element("div");
		editor.className = "cm-editor";
		const inside = element("span", editor);

		expect(prevented(image)).toBe(true);
		expect(prevented(inside)).toBe(true);
	});

	it("blocks a modifier-click on an in-app link and leaves a plain click alone", () => {
		const link = element("a");
		const plain = element("button");

		for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const) {
			const event = new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				[modifier]: true,
			});
			link.dispatchEvent(event);
			expect(event.defaultPrevented, modifier).toBe(true);
		}

		const plainClick = new MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(plainClick);
		expect(plainClick.defaultPrevented).toBe(false);

		const modifiedButton = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			metaKey: true,
		});
		plain.dispatchEvent(modifiedButton);
		expect(modifiedButton.defaultPrevented).toBe(false);
	});

	it("blocks a middle-click on an in-app link and leaves one on a button alone", () => {
		const link = element("a");
		const button = element("button");

		const onLink = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
		link.dispatchEvent(onLink);
		expect(onLink.defaultPrevented).toBe(true);

		const onButton = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
		button.dispatchEvent(onButton);
		expect(onButton.defaultPrevented).toBe(false);
	});
});
