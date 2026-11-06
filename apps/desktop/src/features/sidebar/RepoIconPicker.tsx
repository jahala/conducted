/**
 * @feature PRJ-05 Repository icon
 * Owns: the Change repository icon dialog: the Icons, Emoji, Favicon and Upload sources, the
 * Search emoji field, Remove emoji, and the outcome messages the user sees.
 * Behaviour: ui-map.md 5.2 (the icon picker's sources and the repo icon picker), 5.3 (Change
 * repository icon), 4 (avatar sources), inventory toast rows 904, 905 and 907 for the upload
 * failures.
 * Must handle: a picked emoji or symbol; an upload with a bad type, one over 10 MB, or one that
 * fails to copy; clearing the icon back to the favicon, owner avatar or letter; a cancelled file
 * picker; the picker's own failure shown in the dialog.
 * Test first: searching for "rocket" and choosing the rocket stores an emoji icon.
 */
import { messageOf } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import type { Repo, RepoIconChoice } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { repoIconSource } from "./repo-icon.ts";

type SourceTab = "icons" | "emoji" | "favicon" | "upload";

interface EmojiChoice {
	emoji: string;
	name: string;
	keywords: string;
}

const EMOJI_CHOICES: readonly EmojiChoice[] = [
	{ emoji: "🚀", name: "rocket", keywords: "ship launch fast" },
	{ emoji: "📦", name: "package", keywords: "box release" },
	{ emoji: "🧪", name: "test tube", keywords: "test experiment" },
	{ emoji: "🐛", name: "bug", keywords: "issue fix" },
	{ emoji: "✨", name: "sparkles", keywords: "new polish" },
	{ emoji: "🔥", name: "fire", keywords: "hot urgent" },
	{ emoji: "⚡", name: "bolt", keywords: "fast power" },
	{ emoji: "🛠️", name: "tools", keywords: "build fix" },
	{ emoji: "🧩", name: "puzzle", keywords: "plugin piece" },
	{ emoji: "📚", name: "books", keywords: "docs learn" },
	{ emoji: "🌱", name: "seedling", keywords: "new grow" },
	{ emoji: "🏗️", name: "building", keywords: "build work" },
	{ emoji: "🔍", name: "magnifier", keywords: "search find" },
	{ emoji: "💡", name: "bulb", keywords: "idea light" },
	{ emoji: "🎯", name: "target", keywords: "goal focus" },
	{ emoji: "🧭", name: "compass", keywords: "direction plan" },
	{ emoji: "🛰️", name: "satellite", keywords: "remote space" },
	{ emoji: "🔒", name: "lock", keywords: "secure private" },
	{ emoji: "🧱", name: "bricks", keywords: "foundation build" },
	{ emoji: "🎨", name: "palette", keywords: "design style" },
	{ emoji: "📊", name: "chart", keywords: "data report" },
	{ emoji: "🌍", name: "globe", keywords: "web world" },
	{ emoji: "💬", name: "chat", keywords: "message talk" },
	{ emoji: "⭐", name: "star", keywords: "favourite best" },
];

const ICON_CHOICES: readonly { name: string; glyph: string }[] = [
	{ name: "circle", glyph: "●" },
	{ name: "diamond", glyph: "◆" },
	{ name: "square", glyph: "■" },
	{ name: "triangle", glyph: "▲" },
	{ name: "star", glyph: "★" },
	{ name: "hexagon", glyph: "⬢" },
	{ name: "spark", glyph: "✦" },
	{ name: "cross", glyph: "✚" },
	{ name: "flag", glyph: "⚑" },
	{ name: "command", glyph: "⌘" },
	{ name: "lambda", glyph: "λ" },
	{ name: "infinity", glyph: "∞" },
];

const TABS: readonly { id: SourceTab; label: string }[] = [
	{ id: "icons", label: "Icons" },
	{ id: "emoji", label: "Emoji" },
	{ id: "favicon", label: "Favicon" },
	{ id: "upload", label: "Upload" },
];

export interface RepoIconPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	repo: Repo;
}

export function RepoIconPicker({ open, onOpenChange, repo }: RepoIconPickerProps) {
	const actions = useActions();
	const { platform } = useServices();
	const [tab, setTab] = useState<SourceTab>("emoji");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const source = repoIconSource(repo);
	const needle = query.trim().toLowerCase();
	const emoji =
		needle === ""
			? EMOJI_CHOICES
			: EMOJI_CHOICES.filter(
					(choice) =>
						choice.name.includes(needle) ||
						choice.keywords.includes(needle) ||
						choice.emoji.includes(needle),
				);

	const save = async (icon: RepoIconChoice): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			const result = await actions.projects.setIcon(repo.id, icon);
			if (!result.ok) {
				setError(result.error.message);
				toastError("Couldn't set the icon", result.error);
				return;
			}
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	const upload = async (): Promise<void> => {
		setError(null);
		let picked: string[];
		try {
			picked = await platform.dialogs.pickFiles({
				title: "Choose an icon",
				multiple: false,
			});
		} catch (cause) {
			toastError("Couldn't open the file picker", { message: messageOf(cause) });
			return;
		}
		const path = picked[0];
		if (path === undefined) return;
		await save({ kind: "file", path });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Change repository icon" size="md">
				<div role="tablist" aria-label="Icon sources" className="flex gap-1">
					{TABS.map((entry) => (
						<Button
							key={entry.id}
							variant={tab === entry.id ? "default" : "ghost"}
							size="sm"
							role="tab"
							aria-selected={tab === entry.id}
							onClick={() => {
								setTab(entry.id);
								setError(null);
							}}
						>
							{entry.label}
						</Button>
					))}
				</div>

				{tab === "icons" ? (
					<fieldset
						aria-label="Icons"
						className="m-0 grid grid-cols-6 gap-1 rounded-md border border-border bg-muted p-2"
					>
						{ICON_CHOICES.map((choice) => (
							<button
								key={choice.name}
								type="button"
								aria-label={`Use icon ${choice.name}`}
								aria-pressed={source.kind === "emoji" && source.emoji === choice.glyph}
								disabled={busy}
								onClick={() => void save({ kind: "emoji", emoji: choice.glyph })}
								className="flex size-8 items-center justify-center rounded-md text-base text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{choice.glyph}
							</button>
						))}
					</fieldset>
				) : null}

				{tab === "emoji" ? (
					<div className="flex flex-col gap-2">
						<Input
							type="search"
							aria-label="Search emoji"
							placeholder="Search emoji"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						{emoji.length === 0 ? (
							<p className="text-sm text-fg-muted">No emoji found</p>
						) : (
							<fieldset
								aria-label="Emoji"
								className="m-0 grid grid-cols-8 gap-1 rounded-md border border-border bg-muted p-2"
							>
								{emoji.map((choice) => (
									<button
										key={choice.emoji}
										type="button"
										aria-label={`Use ${choice.emoji}`}
										title={choice.name}
										aria-pressed={source.kind === "emoji" && source.emoji === choice.emoji}
										disabled={busy}
										onClick={() => void save({ kind: "emoji", emoji: choice.emoji })}
										className="flex size-8 items-center justify-center rounded-md text-base hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{choice.emoji}
									</button>
								))}
							</fieldset>
						)}
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={busy || repo.icon === null}
								onClick={() => void save(null)}
							>
								Remove emoji
							</Button>
						</div>
					</div>
				) : null}

				{tab === "favicon" ? (
					<div className="flex flex-col gap-2">
						<p className="text-sm text-fg-muted">
							Use the favicon of the repository's remote, its owner avatar on GitHub, or its first
							letter when there is no remote.
						</p>
						<div>
							<Button variant="outline" size="sm" disabled={busy} onClick={() => void save(null)}>
								Use favicon
							</Button>
						</div>
					</div>
				) : null}

				{tab === "upload" ? (
					<div className="flex flex-col gap-2">
						<p className="text-sm text-fg-muted">
							Choose a PNG, JPEG, GIF, WebP, or SVG image under 10MB.
						</p>
						<div>
							<Button variant="outline" size="sm" loading={busy} onClick={() => void upload()}>
								Upload image
							</Button>
						</div>
					</div>
				) : null}

				{error === null ? null : (
					<p role="alert" className={cn("text-sm", "text-danger")}>
						{error}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
