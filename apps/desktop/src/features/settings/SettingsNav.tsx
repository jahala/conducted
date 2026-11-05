/**
 * @feature SET-02 Settings navigation
 * Owns: the left column of the settings screen: the search box, the grouped page links, the
 * repository picker with its pages, and the Back button.
 * Behaviour: ui-map.md 6 (layout and navigation groups; Back and Esc leave; Cmd+F focuses search).
 * Must handle: the active page marked (aria-current), no repositories (the group says so), many
 * repositories (the picker has type-ahead), and a repository page applying to the picked project.
 * Test first: the active page link has aria-current and the others do not.
 */
import type { RepoId } from "@conducted/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Select } from "../../ui/Select.tsx";
import {
	REPO_SETTINGS_PAGES,
	SETTINGS_NAV_GROUP_TITLES,
	type SettingsNavGroup,
	type SettingsTarget,
	settingsTargetKey,
	USER_SETTINGS_PAGES,
} from "./settings-pages.ts";

export interface SettingsNavProps {
	active: SettingsTarget;
	repos: { id: string; name: string }[];
	/** True while the project list is still being read. */
	reposLoading?: boolean;
	onNavigate: (target: SettingsTarget) => void;
	onBack: () => void;
	searchSlot: ReactNode;
}

const GROUPS: readonly SettingsNavGroup[] = ["personal", "agents_and_environment", "more"];

const linkClass = (active: boolean) =>
	cn(
		"flex h-8 w-full items-center rounded-md px-2 text-left text-sm transition-colors",
		active ? "bg-hover font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
	);

export function SettingsNav({
	active,
	repos,
	reposLoading = false,
	onNavigate,
	onBack,
	searchSlot,
}: SettingsNavProps) {
	const activeRepoId = active.kind === "repo" ? active.repoId : null;
	const [pickedRepoId, setPickedRepoId] = useState<string | null>(null);
	const selectedRepoId = activeRepoId ?? pickedRepoId ?? repos[0]?.id ?? "";
	const activeKey = settingsTargetKey(active);

	useEffect(() => {
		if (activeRepoId !== null) setPickedRepoId(activeRepoId);
	}, [activeRepoId]);

	return (
		<aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface/40 p-3">
			<Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
				Back
			</Button>
			<div>{searchSlot}</div>

			<nav aria-label="Settings" className="flex flex-col gap-4">
				{GROUPS.map((group) => (
					<div key={group} className="flex flex-col gap-0.5">
						<p className="px-2 pb-1 text-xs font-medium text-fg-subtle">
							{SETTINGS_NAV_GROUP_TITLES[group]}
						</p>
						{USER_SETTINGS_PAGES.filter((page) => page.group === group).map((page) => {
							const isActive = activeKey === settingsTargetKey({ kind: "user", page: page.id });
							return (
								<button
									key={page.id}
									type="button"
									className={linkClass(isActive)}
									aria-current={isActive ? "page" : undefined}
									onClick={() => onNavigate({ kind: "user", page: page.id })}
								>
									{page.title}
								</button>
							);
						})}
					</div>
				))}

				<div className="flex flex-col gap-1">
					<p className="px-2 pb-1 text-xs font-medium text-fg-subtle">Repositories</p>
					{reposLoading ? (
						<p role="status" className="px-2 text-xs text-fg-muted">
							Loading projects…
						</p>
					) : repos.length === 0 ? (
						<p className="px-2 text-xs text-fg-muted">
							No projects yet. Add a project to edit repository settings.
						</p>
					) : (
						<>
							<Select
								aria-label="Repository"
								value={selectedRepoId}
								options={repos.map((repo) => ({ value: repo.id, label: repo.name }))}
								onValueChange={(repoId) => {
									setPickedRepoId(repoId);
									onNavigate({ kind: "repo", repoId: repoId as RepoId, page: "scripts" });
								}}
							/>
							{REPO_SETTINGS_PAGES.map((page) => {
								const isActive =
									selectedRepoId !== "" &&
									activeKey ===
										settingsTargetKey({
											kind: "repo",
											repoId: selectedRepoId as RepoId,
											page: page.id,
										});
								return (
									<button
										key={page.id}
										type="button"
										className={linkClass(isActive)}
										aria-current={isActive ? "page" : undefined}
										disabled={selectedRepoId === ""}
										onClick={() =>
											onNavigate({
												kind: "repo",
												repoId: selectedRepoId as RepoId,
												page: page.id,
											})
										}
									>
										{page.title}
									</button>
								);
							})}
						</>
					)}
				</div>
			</nav>
		</aside>
	);
}
