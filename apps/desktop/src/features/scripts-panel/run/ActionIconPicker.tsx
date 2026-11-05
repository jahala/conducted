/**
 * @feature SET-07 Action icon picker
 * Owns: a searchable grid of icons for an action, and the small renderer that draws one by name.
 * Behaviour: ui-map.md 3.7 (icon picker: "Search icons", "No icons found"); ui-map.md 8 (icons are
 * simple line marks). The set is ours; it is not copied from an icon library (D002).
 * Must handle: no match (designed empty text), keyboard selection (every icon is a button),
 * the current icon marked, and a stored icon name that no longer exists (shown as the default
 * icon and reported in the log).
 * Test first: searching "play" narrows the grid to icons whose name contains it.
 */
import { useState } from "react";
import { cn } from "../../../ui/cn.ts";
import { Input } from "../../../ui/Input.tsx";

interface ActionIconDefinition {
	name: string;
	path: string;
}

/** The icons an action can use. Names are stable and stored in the settings file. */
export const ACTION_ICONS: readonly ActionIconDefinition[] = [
	{ name: "play", path: "M5 3.5l7 4.5-7 4.5z" },
	{ name: "stop", path: "M4.5 4.5h7v7h-7z" },
	{ name: "terminal", path: "M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5" },
	{ name: "test", path: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM5.5 8l1.75 1.75L10.5 6.5" },
	{ name: "server", path: "M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11zM4.5 5h.01M4.5 11h.01" },
	{ name: "build", path: "M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8h4M6 10.5h4" },
	{ name: "lint", path: "M10.5 2.5l3 3-7.5 7.5-3.5.5.5-3.5zM8.5 4.5l3 3" },
	{ name: "database", path: "M8 3c3 0 5 .8 5 1.5S11 6 8 6 3 5.3 3 4.5 5 3 8 3zM3 4.5v7c0 .7 2 1.5 5 1.5s5-.8 5-1.5v-7" },
	{ name: "browser", path: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" },
	{ name: "code", path: "M6 5L3 8l3 3M10 5l3 3-3 3" },
	{ name: "bug", path: "M8 5.5a2.5 2.5 0 0 1 2.5 2.5v2a2.5 2.5 0 0 1-5 0V8A2.5 2.5 0 0 1 8 5.5zM3.5 8h2M10.5 8h2M4.5 5l1.5 1M11.5 5L10 6M4.5 11l1.5-1M11.5 11L10 10" },
	{ name: "rocket", path: "M9 2.5c2.5 1 4 3.5 4 6.5l-3 3H6l-3-3c0-3 1.5-5.5 4-6.5zM6 12l-1 2M10 12l1 2M7 7h.01M9 7h.01" },
	{ name: "package", path: "M8 2.5l5 2.5v6l-5 2.5L3 11V5zM3 5l5 2.5L13 5M8 7.5v6" },
	{ name: "refresh", path: "M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" },
];

const DEFAULT_ICON = "play";

const iconsByName = new Map(ACTION_ICONS.map((icon) => [icon.name, icon]));

export interface ActionIconProps {
	/** Null uses the default icon. */
	name: string | null;
	className?: string;
}

/** Draws one action icon. An unknown name falls back to the default and is reported. */
export function ActionIcon({ name, className }: ActionIconProps) {
	const found = name === null ? undefined : iconsByName.get(name);
	const icon = found ?? iconsByName.get(DEFAULT_ICON);
	if (name !== null && found === undefined) {
		console.error(`Unknown action icon "${name}". Using the default icon.`);
	}
	if (icon === undefined) return null;
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={cn("size-4 shrink-0", className)}
		>
			<path d={icon.path} />
		</svg>
	);
}

export interface ActionIconPickerProps {
	selected: string | null;
	onSelect: (iconName: string) => void;
}

export function ActionIconPicker({ selected, onSelect }: ActionIconPickerProps) {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const icons =
		needle === ""
			? ACTION_ICONS
			: ACTION_ICONS.filter((icon) => icon.name.toLowerCase().includes(needle));

	return (
		<div className="flex flex-col gap-2">
			<Input
				type="search"
				aria-label="Search icons"
				placeholder="Search icons"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			{icons.length === 0 ? (
				<p className="text-sm text-fg-muted">No icons found</p>
			) : (
				<div
					role="group"
					aria-label="Action icons"
					className="grid grid-cols-7 gap-1 rounded-md border border-border bg-muted p-2"
				>
					{icons.map((icon) => (
						<button
							key={icon.name}
							type="button"
							aria-label={icon.name}
							title={icon.name}
							aria-pressed={selected === icon.name}
							onClick={() => onSelect(icon.name)}
							className={cn(
								"flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors",
								"hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								selected === icon.name && "bg-active text-fg",
							)}
						>
							<ActionIcon name={icon.name} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}
