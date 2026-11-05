/**
 * @feature RUN-03 Preview URL menu
 * Owns: the split Open button's menu: the list of URLs the workspace can be opened at, with the
 * first as default.
 * Behaviour: ui-map.md 3.7 ("Open", "Choose preview URL"; sources: the Run tab's URL, ports
 * detected from output, the repository's Preview URLs template; "Open localhost URL" Cmd+Shift+B).
 * The menu hands the chosen URL to `onOpen`; the Run tab passes `useUrlOpeners`, so the in-app
 * browser setting decides whether it opens in the browser tab or the system browser.
 * Must handle: no URLs, duplicate URLs from different sources (shown once), and a caller that
 * offers a default choice among several URLs.
 * Test first: two sources giving the same URL show one entry.
 */
import { Button } from "../../../ui/Button.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "../../../ui/icons.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../../../ui/Menu.tsx";

export interface PreviewUrlMenuProps {
	urls: { label: string; url: string; source: "run_output" | "detected_port" | "template" }[];
	defaultUrl: string | null;
	onOpen: (url: string) => void;
	/** When provided, the menu lets the caller choose which URL Open uses by default. */
	onSetDefault?: (url: string) => void;
}

export function PreviewUrlMenu({ urls, defaultUrl, onOpen, onSetDefault }: PreviewUrlMenuProps) {
	const seen = new Set<string>();
	const entries = urls.filter((entry) => {
		if (seen.has(entry.url)) return false;
		seen.add(entry.url);
		return true;
	});
	const chosen = entries.find((entry) => entry.url === defaultUrl) ?? entries[0] ?? null;
	const empty = entries.length === 0;
	const openDefault = (): void => {
		if (chosen !== null) onOpen(chosen.url);
	};

	return (
		<div className="flex shrink-0">
			<Button
				variant="outline"
				size="sm"
				className="rounded-r-none"
				disabled={empty}
				title={chosen === null ? "No preview URL yet" : chosen.url}
				onClick={openDefault}
			>
				Open
			</Button>
			<Menu>
				<MenuTrigger asChild>
					<IconButton
						label="Choose preview URL"
						icon={<ChevronDownIcon />}
						variant="outline"
						size="sm"
						className="rounded-l-none border-l-0"
					/>
				</MenuTrigger>
				<MenuContent align="start">
					<MenuLabel>Preview URLs</MenuLabel>
					{empty ? (
						<MenuItem disabled>No preview URLs yet</MenuItem>
					) : (
						entries.map((entry) => (
							<MenuItem
								key={entry.url}
								icon={entry.url === chosen?.url ? <CheckIcon /> : <GlobeIcon />}
								onSelect={() => onOpen(entry.url)}
							>
								{entry.label}
							</MenuItem>
						))
					)}
					{entries.length > 1 && onSetDefault !== undefined ? (
						<>
							<MenuSeparator />
							<MenuSub>
								<MenuSubTrigger>Default URL</MenuSubTrigger>
								<MenuSubContent>
									<MenuRadioGroup
										value={chosen?.url ?? ""}
										onValueChange={(url) => onSetDefault(url)}
									>
										{entries.map((entry) => (
											<MenuRadioItem key={entry.url} value={entry.url}>
												{entry.label}
											</MenuRadioItem>
										))}
									</MenuRadioGroup>
								</MenuSubContent>
							</MenuSub>
						</>
					) : null}
				</MenuContent>
			</Menu>
		</div>
	);
}
