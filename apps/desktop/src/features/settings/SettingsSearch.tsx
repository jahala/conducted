/**
 * @feature SET-02 Settings search
 * Owns: the search box and its result list. Typing searches every setting's title, description and
 * keywords; choosing a result opens its page and highlights the setting.
 * Behaviour: ui-map.md 6 ("Search settings", Cmd+F, fuzzy over labels, descriptions and keywords,
 * top 30 results, arrow keys and Enter). The index comes from the settings and command registries.
 * Children: uses searchSettings from settings-search.ts.
 * Must handle: an empty query (no list), no result (designed empty text), arrow keys wrapping,
 * Enter on no selection doing nothing, and Escape clearing the query before the settings screen
 * handles the next press.
 * Test first: typing "zoom" lists the zoom setting first and Enter calls onOpen with its id.
 */
import { type RefObject, useMemo, useRef, useState } from "react";
import { Input } from "../../ui/Input.tsx";
import { type SearchableSetting, searchSettings } from "./settings-search.ts";

export interface SettingsSearchProps {
	index: readonly SearchableSetting[];
	onOpen: (setting: SearchableSetting) => void;
	/** The screen's own ref, so Cmd+F can focus the box. */
	inputRef?: RefObject<HTMLInputElement | null>;
}

export function SettingsSearch({ index, onOpen, inputRef }: SettingsSearchProps) {
	const ownRef = useRef<HTMLInputElement>(null);
	const ref = inputRef ?? ownRef;
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const results = useMemo(() => searchSettings(index, query, 30), [index, query]);

	const open = (setting: SearchableSetting | undefined) => {
		if (setting === undefined) return;
		onOpen(setting);
	};

	return (
		<div className="flex flex-col gap-2">
			<Input
				ref={ref}
				type="search"
				aria-label="Search settings"
				placeholder="Search settings"
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
					setActive(0);
				}}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
						return;
					}
					if (event.key === "ArrowUp") {
						event.preventDefault();
						setActive((current) =>
							results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
						);
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						open(results[active]);
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
			{query.trim() === "" ? null : results.length === 0 ? (
				<p role="status" className="px-1 text-xs text-fg-muted">
					No settings match your search.
				</p>
			) : (
				<ul aria-label="Settings search results" className="flex flex-col gap-0.5">
					{results.map((setting, index) => (
						<li key={setting.key}>
							<button
								type="button"
								aria-current={index === active ? "true" : undefined}
								className={
									index === active
										? "block w-full rounded-md bg-hover px-2 py-1 text-left"
										: "block w-full rounded-md px-2 py-1 text-left"
								}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => open(setting)}
								onMouseEnter={() => setActive(index)}
							>
								<span className="block text-sm text-fg">{setting.title}</span>
								<span className="block truncate text-xs text-fg-muted">{setting.description}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
