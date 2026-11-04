/**
 * @feature NAV-01 Title bar inset
 * Owns: an empty spacer that keeps a header's content clear of the window controls (traffic lights and the
 * sidebar, back and forward buttons) when the left sidebar is closed.
 * Behaviour: ui-map.md 1.1 (traffic lights are inset by a CSS variable; toggle buttons shift right of it).
 * Our design choice: the app shell sets `--shell-left-inset` on the root element. It is 0 while the sidebar
 * is open and the width of the controls while it is closed. Headers that can sit at the window's top left
 * start with this spacer. Outside the shell the variable is unset and the spacer has no width.
 * Must handle: no variable set (width 0), reduced motion (no width transition), hidden from screen readers.
 * Test first: renders an aria-hidden element whose width reads var(--shell-left-inset, 0px).
 */
export function TitleBarInset() {
	return (
		<span
			aria-hidden="true"
			className="block h-full w-[var(--shell-left-inset,0px)] shrink-0 transition-[width]"
		/>
	);
}
