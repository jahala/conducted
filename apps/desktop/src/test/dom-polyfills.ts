/**
 * @feature APP-05 jsdom gaps
 * Owns: browser APIs that jsdom lacks and that the resizable panels, toasts and the message list's
 * gap marker read when they mount.
 * Behaviour: not applicable, test support only.
 * Must handle: importing this file twice is harmless; it never replaces an API jsdom already has
 * (except `scrollTo`, which jsdom has but only prints "not implemented"); a file that runs without
 * a window (node environment) is left alone.
 * Test first: not applicable.
 *
 * Our design choice: these are empty stand-ins for layout measurement. Tests that depend on real sizes
 * belong in a browser test, not here.
 */
const hasWindow = typeof window !== "undefined";

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

if (hasWindow && typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = NoopResizeObserver;
}

/** Never reports: with no layout nothing comes into view. The message list's gap marker reads it. */
class NoopIntersectionObserver {
	readonly root = null;
	readonly rootMargin = "0px";
	readonly scrollMargin = "0px";
	readonly thresholds: readonly number[] = [];
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

if (hasWindow && typeof globalThis.IntersectionObserver === "undefined") {
	globalThis.IntersectionObserver = NoopIntersectionObserver;
}

if (hasWindow && typeof window.matchMedia === "undefined") {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;
}

// jsdom prints "not implemented" for scrolling, which the router's scroll restoration calls.
if (hasWindow) window.scrollTo = () => {};

// jsdom has no scrollIntoView, which select lists and the diff view call.
if (hasWindow && typeof Element.prototype.scrollIntoView !== "function") {
	Element.prototype.scrollIntoView = () => {};
}

// jsdom has no scrollBy, which the message list calls to keep its view still when older turns
// join at its top (CHAT-06).
if (hasWindow && typeof Element.prototype.scrollBy !== "function") {
	Element.prototype.scrollBy = () => {};
}
