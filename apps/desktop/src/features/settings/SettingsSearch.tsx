/**
 * @feature SET-02 Settings search
 * Owns: the search box and its result popover. Typing searches every setting's title, description and
 * keywords; choosing a result opens its page and highlights the setting.
 * Behaviour: ui-map.md 6 ("Search settings", Cmd+F, fuzzy over labels, descriptions and keywords,
 * top 30 results, arrow keys and Enter). renderApp Jil (@11761913): the wrapper is `relative w-full
 * min-w-0`, the field is `h-7 pl-8 pr-10` with no spell check, the shortcut shows only while the query
 * is empty, the results open in a popover as wide as the field, and the active row scrolls into view.
 * The index comes from the settings and command registries.
 * Children: uses searchSettings from settings-search.ts, and Popover from ui/Popover.tsx.
 * Must handle: an empty query (no popover), no result (designed empty text), the shortcut hint named
 * for assistive technology, a clear button that empties the query, arrow keys where the selection
 * wraps, Enter on no selection doing nothing, Escape clearing the query before the settings screen
 * handles the next press, and a press inside the field keeping the popover open.
 * Test first: typing "zoom" lists the zoom setting first and Enter calls onOpen with its id.
 */
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../ui/Input.tsx";
import { CloseIcon, SearchIcon } from "../../ui/icons.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { type SearchableSetting, searchSettings } from "./settings-search.ts";

export interface SettingsSearchProps {
	/** The live key that focuses the field, shown at its right ("⌘F"). */
	searchShortcut?: string | null;
	index: readonly SearchableSetting[];
	onOpen: (setting: SearchableSetting) => void;
	/** The screen's own ref, so Cmd+F can focus the box. */
	inputRef?: RefObject<HTMLInputElement | null>;
}

export function SettingsSearch({
	index,
	onOpen,
	inputRef,
	searchShortcut = null,
}: SettingsSearchProps) {
	const ownRef = useRef<HTMLInputElement>(null);
	const fieldRef = useRef<HTMLDivElement>(null);
	const resultsRef = useRef<HTMLUListElement>(null);
	const ref = inputRef ?? ownRef;
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const open = query.trim() !== "";
	const results = useMemo(() => searchSettings(index, query, 30), [index, query]);

	const openSetting = (setting: SearchableSetting | undefined) => {
		if (setting === undefined) return;
		onOpen(setting);
		// Conductor's T navigates and then empties the query: the popover has done its job, and
		// the next Escape belongs to the settings screen.
		setQuery("");
		setActive(0);
	};

	// Conductor scrolls the highlighted row into the popover's view as the arrows move.
	useEffect(() => {
		if (!open) return;
		resultsRef.current?.querySelector(`[data-result-index="${active}"]`)?.scrollIntoView({
			block: "nearest",
		});
	}, [active, open]);

	return (
		<Popover
			anchor={
				<div ref={fieldRef} className="relative w-full min-w-0">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-muted" />
					{searchShortcut === null || query !== "" ? null : (
						<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
							<Kbd aria-label="Search settings shortcut">{searchShortcut}</Kbd>
						</span>
					)}
					{query === "" ? null : (
						<button
							type="button"
							aria-label="Clear settings search"
							className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-fg-muted hover:text-fg"
							onClick={() => {
								setQuery("");
								setActive(0);
								ref.current?.focus();
							}}
						>
							<CloseIcon className="size-3.5" />
						</button>
					)}
					<Input
						ref={ref}
						type="search"
						height="sm"
						aria-label="Search settings"
						placeholder="Search settings"
						spellCheck={false}
						className="w-full min-w-0 pr-10 pl-8"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActive((current) =>
									Math.min(Math.max(current + 1, 0), Math.max(results.length - 1, 0)),
								);
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setActive((current) =>
									Math.min(Math.max(current - 1, 0), Math.max(results.length - 1, 0)),
								);
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								openSetting(results[active]);
								return;
							}
							if (event.key === "Escape" && query !== "") {
								event.preventDefault();
								event.stopPropagation();
								setQuery("");
								setActive(0);
							}
						}}
					/>
				</div>
			}
			open={open}
			onOpenChange={(next) => {
				// A press outside the field, or Escape over the results, closes the popover the way
				// Conductor's own popover closes: the query empties and the field stays in place.
				if (!next && query !== "") {
					setQuery("");
					setActive(0);
				}
			}}
			keepOpenWithin={fieldRef}
			side="bottom"
			align="end"
			padded={false}
			className="flex w-[var(--radix-popper-anchor-width)] max-h-[min(480px,var(--radix-popper-available-height))] flex-col gap-0.5 overflow-y-auto p-1"
		>
			{results.length === 0 ? (
				<p role="status" className="px-1 py-1.5 text-xs text-fg-muted">
					No settings match "{query}"
				</p>
			) : (
				<ul ref={resultsRef} aria-label="Settings search results" className="flex flex-col gap-0.5">
					{results.map((setting, index) => (
						<li key={setting.key}>
							<button
								type="button"
								data-result-index={index}
								aria-current={index === active ? "true" : undefined}
								className={
									index === active
										? "block w-full rounded-md bg-hover px-2 py-1 text-left"
										: "block w-full rounded-md px-2 py-1 text-left"
								}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => openSetting(setting)}
								onMouseMove={() => setActive(index)}
							>
								<span className="block text-sm text-fg">{setting.title}</span>
								<span className="block truncate text-xs text-fg-muted">{setting.description}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</Popover>
	);
}
