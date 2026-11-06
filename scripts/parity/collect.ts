/**
 * Reads one settled catalogue state in the browser: every visible string and control name, and the
 * computed styles of the elements the layout check measures. `collectState` runs inside the page
 * (Playwright sends its source), so it uses nothing from outside its own body.
 * Behaviour: docs/plans/parity-harness.md section 3 (checks b and c).
 * Our design choice: a visible string is read per text unit, the nearest element around a text node
 * that is not drawn inline (flex and grid children count as their own units) or is a control. Inline
 * pieces of one sentence stay one string, and a row's separate cells stay separate.
 * Must handle: hidden elements and their text are skipped; an element with only an aria-label, a
 * placeholder, a title or an alt is still a name; a layout locator that finds nothing is reported as
 * not found, never as zero.
 */
/// <reference lib="dom" />
import type { DomName, LayoutReading } from "./lib.ts";

export interface Locator {
	/** A CSS selector for the candidates. */
	css: string;
	/** Keeps only candidates whose text contains this, after normalising. */
	hasText?: string;
}

export interface LayoutProbe {
	id: string;
	locator: Locator;
	/** Values to read: computed style properties, `height` and `width` from the box, and `parent.<property>`. */
	read: string[];
}

export interface Collected {
	names: DomName[];
	layout: LayoutReading[];
}

export function collectState(probes: LayoutProbe[]): Collected {
	const CONTROL =
		"button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=option],[role=checkbox],[role=switch],[role=radio],[role=combobox],[role=treeitem]";
	const norm = (text: string): string =>
		text
			.replace(/…/g, "...")
			.replace(/[‘’]/g, "'")
			.replace(/[“”]/g, '"')
			.replace(/ /g, " ")
			.replace(/\s+/g, " ")
			.trim();
	const shown = (element: Element): boolean => {
		const options = { checkOpacity: true, checkVisibilityCSS: true };
		if (!element.checkVisibility(options)) return false;
		const box = element.getBoundingClientRect();
		return box.width > 0 && box.height > 0;
	};
	const roleOf = (element: Element): string => {
		const role = element.getAttribute("role");
		if (role !== null) return role;
		const tag = element.tagName.toLowerCase();
		if (tag === "a" && element.hasAttribute("href")) return "link";
		if (tag === "button" || tag === "summary") return "button";
		if (tag === "select") return "combobox";
		if (tag === "textarea") return "textbox";
		if (tag === "input") {
			const type = (element.getAttribute("type") ?? "text").toLowerCase();
			if (type === "checkbox" || type === "radio") return type;
			if (type === "button" || type === "submit") return "button";
			return "textbox";
		}
		if (/^h[1-6]$/.test(tag)) return "heading";
		return tag;
	};
	const selectorOf = (element: Element): string => {
		const parts: string[] = [];
		let current: Element | null = element;
		while (current !== null && current !== document.body) {
			const testId = current.getAttribute("data-testid");
			if (testId !== null) {
				parts.unshift(`[data-testid="${testId}"]`);
				break;
			}
			const tag = current.tagName.toLowerCase();
			const parent: Element | null = current.parentElement;
			const same =
				parent === null
					? []
					: [...parent.children].filter((child) => child.tagName === current?.tagName);
			parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
			current = parent;
		}
		return parts.join(" > ");
	};
	const unitOf = (element: Element): Element => {
		const control = element.closest(CONTROL);
		let current: Element | null = element;
		while (current !== null && current !== document.body) {
			if (current === control) return current;
			const display = getComputedStyle(current).display;
			if (display !== "inline" && display !== "contents") return current;
			current = current.parentElement;
		}
		return control ?? element;
	};

	const names: DomName[] = [];
	const seen = new Set<string>();
	const add = (element: Element, text: string, via: DomName["via"]): void => {
		const clean = norm(text);
		if (clean === "" || !/[\p{L}\p{N}]/u.test(clean)) return;
		const role = roleOf(element);
		const key = `${via}\u0000${clean}\u0000${role}`;
		if (seen.has(key)) return;
		seen.add(key);
		names.push({ text: clean, via, role, selector: selectorOf(element) });
	};

	const units = new Map<Element, string>();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const parent = node.parentElement;
		if (parent === null || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
		if (!/[\p{L}\p{N}]/u.test(node.textContent ?? "")) continue;
		const unit = unitOf(parent);
		units.set(unit, (units.get(unit) ?? "") + (node.textContent ?? ""));
	}
	for (const [unit, text] of units) if (shown(unit)) add(unit, text, "text");
	for (const element of document.body.querySelectorAll("*")) {
		if (!shown(element)) continue;
		const label = element.getAttribute("aria-label");
		if (label !== null) add(element, label, "aria-label");
		for (const attribute of ["placeholder", "aria-placeholder", "data-placeholder"]) {
			const value = element.getAttribute(attribute);
			if (value !== null) add(element, value, "placeholder");
		}
		const title = element.getAttribute("title");
		if (title !== null) add(element, title, "title");
		const alt = element.getAttribute("alt");
		if (alt !== null) add(element, alt, "alt");
		const testId = element.getAttribute("data-testid");
		if (testId !== null) add(element, testId, "testid");
	}

	const camel = (property: string): string =>
		property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
	const layout: LayoutReading[] = probes.map((probe) => {
		const wanted = probe.locator.hasText === undefined ? null : norm(probe.locator.hasText);
		const candidates = [...document.querySelectorAll(probe.locator.css)].filter(
			(candidate) =>
				shown(candidate) && (wanted === null || norm(candidate.textContent ?? "").includes(wanted)),
		);
		// With a text filter, the innermost candidate: an outer box holds the same text.
		const element =
			wanted === null
				? candidates[0]
				: candidates.find(
						(candidate) =>
							!candidates.some((other) => other !== candidate && candidate.contains(other)),
					);
		if (element === undefined) return { id: probe.id, found: false, values: {} };
		const values: Record<string, number> = {};
		for (const key of probe.read) {
			const onParent = key.startsWith("parent.");
			const target = onParent ? element.parentElement : element;
			const property = onParent ? key.slice("parent.".length) : key;
			if (target === null) continue;
			if (property === "height" || property === "width") {
				values[key] = target.getBoundingClientRect()[property];
				continue;
			}
			const raw = getComputedStyle(target).getPropertyValue(property) || "";
			const fallback = (getComputedStyle(target) as unknown as Record<string, string>)[
				camel(property)
			];
			const value = raw === "" ? (fallback ?? "") : raw;
			// A gap of "normal" is no gap in a flex or grid box; any other word has no number.
			const number = value === "normal" ? 0 : Number.parseFloat(value);
			if (!Number.isNaN(number)) values[key] = number;
		}
		return { id: probe.id, found: true, values, selector: selectorOf(element) };
	});
	return { names, layout };
}
