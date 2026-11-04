/**
 * @feature APP-05 Class name joiner
 * Owns: joining class names and dropping falsy parts, so components can switch classes on state.
 * Behaviour: ui-map.md 8 (Tailwind tokens as CSS variables).
 * Must handle: false, null and undefined parts; empty input gives an empty string.
 * Test first: cn("a", false, "b") returns "a b".
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}
