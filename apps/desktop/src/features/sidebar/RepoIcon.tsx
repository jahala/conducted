/**
 * @feature PRJ-05 Repository icon
 * Owns: drawing a repository avatar from its source, and the right-click menu that opens the icon
 * picker from the sidebar.
 * Behaviour: ui-map.md 4 (workspace row repo avatar), 5.3 ("Repo icon: Change repository icon").
 * Must handle: an emoji or symbol; an uploaded image loaded through the asset protocol; a favicon or
 * GitHub owner avatar; a letter fallback, also shown when an image fails to load (most hosts have
 * no favicon, and an owner avatar is unreachable offline). The picker mounts only when it opens, so a row that never
 * opens it needs no services.
 * Test first: right-clicking the avatar offers Change repository icon, and choosing it opens the
 * picker.
 */
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { cn } from "../../ui/cn.ts";
import { RepoIconPicker } from "./RepoIconPicker.tsx";
import { type RepoIconSource, repoIconSource, repoLetter } from "./repo-icon.ts";

export function RepoIconView({
	source,
	letter,
	assetUrl,
	className,
}: {
	source: RepoIconSource;
	/** Shown in place of an image that fails to load. */
	letter: string;
	assetUrl?: (path: string) => string;
	className?: string;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	const failedSource = source.kind === "file" ? source.path : "url" in source ? source.url : null;
	if (failedSource !== null && failed === failedSource) {
		return <span className={cn("leading-none", className)}>{letter}</span>;
	}
	const onError = () => setFailed(failedSource);
	switch (source.kind) {
		case "emoji":
			return <span className={cn("leading-none", className)}>{source.emoji}</span>;
		case "letter":
			return <span className={cn("leading-none", className)}>{source.letter}</span>;
		case "file":
			return (
				<img
					src={assetUrl === undefined ? source.path : assetUrl(source.path)}
					alt=""
					onError={onError}
					className={cn("size-full rounded-sm object-cover", className)}
				/>
			);
		case "favicon":
		case "owner":
			return (
				<img
					src={source.url}
					alt=""
					onError={onError}
					className={cn("size-full rounded-sm object-cover", className)}
				/>
			);
	}
}

function FileRepoIcon({ path, letter }: { path: string; letter: string }) {
	const { platform } = useServices();
	return (
		<RepoIconView source={{ kind: "file", path }} letter={letter} assetUrl={platform.fs.assetUrl} />
	);
}

export function RepoIconAvatar({ repo, className }: { repo: Repo; className?: string }) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const source = repoIconSource(repo);
	const letter = repoLetter(repo.name);
	const view =
		source.kind === "file" ? (
			<FileRepoIcon path={source.path} letter={letter} />
		) : (
			<RepoIconView source={source} letter={letter} />
		);

	return (
		<>
			<ContextMenu
				items={
					<ContextMenuItem onSelect={() => setPickerOpen(true)}>
						Change repository icon
					</ContextMenuItem>
				}
			>
				<span
					role="img"
					aria-label={`${repo.name} icon`}
					title={repo.name}
					className={cn(
						"flex size-4 shrink-0 items-center justify-center rounded-sm bg-hover text-3xs font-medium text-fg-muted",
						className,
					)}
				>
					{view}
				</span>
			</ContextMenu>
			{pickerOpen ? (
				<RepoIconPicker open={pickerOpen} onOpenChange={setPickerOpen} repo={repo} />
			) : null}
		</>
	);
}
