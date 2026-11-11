/**
 * @feature APP-01 Browser menu guard
 * Owns: the document-level listeners that stop the web view's own browser menu and its new-window
 * navigation.
 * Behaviour: renderApp `Acs`/`Tcs` (Conductor 0.92.1): one `contextmenu` listener calls
 * `preventDefault()` unless the click is in a text field, one `click` listener stops a modifier-click
 * on an in-app link, and one `auxclick` listener stops a middle-click on one.
 * Must handle: an input, a textarea or a contenteditable field keeps the system menu; an image and a
 * CodeMirror editor block it; app menus still open because their own handler runs first.
 * Test first: a right-click on a plain link blocks the browser menu.
 */

/** A field that keeps the system text menu, as Conductor's `Tcs`: inputs, textareas, contenteditable. */
export function keepsBrowserMenu(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	if (target.closest("img") !== null) return false;
	if (target.closest(".cm-editor") !== null) return false;
	if (target.closest("input, textarea") !== null) return true;
	const editable = target.closest("[contenteditable]");
	return editable instanceof HTMLElement && editable.isContentEditable;
}

/** The link an event acts on, as Conductor's `L$n`, or null when it is not on a link. */
function linkOf(event: MouseEvent): HTMLAnchorElement | null {
	return event.target instanceof Element ? event.target.closest("a") : null;
}

/** Installs the listeners once at app start. Returns the function that removes them. */
export function installBrowserMenuGuard(): () => void {
	const onContextMenu = (event: MouseEvent): void => {
		if (!keepsBrowserMenu(event.target)) event.preventDefault();
	};
	const onClick = (event: MouseEvent): void => {
		if (
			linkOf(event) !== null &&
			(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
		) {
			event.preventDefault();
		}
	};
	const onAuxClick = (event: MouseEvent): void => {
		if (linkOf(event) !== null) event.preventDefault();
	};

	document.addEventListener("contextmenu", onContextMenu);
	document.addEventListener("click", onClick);
	document.addEventListener("auxclick", onAuxClick);

	return () => {
		document.removeEventListener("contextmenu", onContextMenu);
		document.removeEventListener("click", onClick);
		document.removeEventListener("auxclick", onAuxClick);
	};
}
