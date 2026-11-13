/**
 * @feature SET-02 Settings navigation
 * Owns: the left column of the settings screen: the search box, the grouped page links, the
 * repository picker with its pages, and the Back button.
 * Behaviour: ui-map.md 6 (layout and navigation groups; Back and Esc leave; Cmd+F focuses search).
 * Conductor's Back sits in the window's title bar row (renderApp prl, @11773158): a 32 px drag
 * region with 8 px above, the button at its right with "Esc" as its tooltip.
 * A repository is one entry (Conductor's hrl): the open one is in medium text with its sections in
 * an indented column with a rule at its left, each with its icon as the other pages have; a click
 * opens the repository at Environment.
 * The MCP page is listed only while the cloud organisation is active, as Conductor lists it.
 * Must handle: the active page marked (aria-current), no repositories (the group says so), many
 * repositories (the picker has type-ahead), and a repository page applying to the picked project.
 * Test first: the active page link has aria-current and the others do not.
 */
import type { RepoId } from "@conducted/shared";
import type { ReactElement, ReactNode, SVGProps } from "react";
import { cn } from "../../ui/cn.ts";
import {
	ArrowLeftIcon,
	BlocksIcon,
	BotIcon,
	CpuIcon,
	FileCodeIcon,
	FlaskIcon,
	GitBranchIcon,
	GlobeIcon,
	KeyboardIcon,
	KeyIcon,
	MousePointerClickIcon,
	PaletteIcon,
	PlugIcon,
	SlidersIcon,
	UserCircleIcon,
	WrenchIcon,
} from "../../ui/icons.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import {
	DEFAULT_REPO_SETTINGS_PAGE,
	REPO_SETTINGS_PAGES,
	type RepoSettingsPageId,
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
	/** True while the switcher's active entry is the paired Worker: the cloud-only pages show. */
	cloudActive?: boolean;
}

/** Conductor's order: Personal, Agents & environment, the repositories, then More. */
const GROUPS_BEFORE_REPOSITORIES: readonly SettingsNavGroup[] = [
	"personal",
	"agents_and_environment",
];
const GROUPS_AFTER_REPOSITORIES: readonly SettingsNavGroup[] = ["more"];

/** Each repository section's 16px icon: Conductor's git-branch, key, file-code, pointer and sliders. */
const REPO_PAGE_ICONS: Record<
	RepoSettingsPageId,
	(props: SVGProps<SVGSVGElement>) => ReactElement
> = {
	git: GitBranchIcon,
	environment: KeyIcon,
	scripts: FileCodeIcon,
	actions: MousePointerClickIcon,
	misc: SlidersIcon,
};

/** Each page's 16px icon in the nav (Conductor gives every entry one). */
const PAGE_ICONS: Record<string, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
	general: SlidersIcon,
	account: UserCircleIcon,
	appearance: PaletteIcon,
	"key-bindings": KeyboardIcon,
	models: CpuIcon,
	git: GitBranchIcon,
	connections: PlugIcon,
	agents: BotIcon,
	environment: KeyIcon,
	cloud: GlobeIcon,
	mcp: BlocksIcon,
	"remote-control": GlobeIcon,
	experimental: FlaskIcon,
	advanced: WrenchIcon,
};

/** Conductor's settings nav entry: 8px sides, 6px top and bottom, 12px gap, 6px radius, a 16px icon. */
const linkClass = (active: boolean) =>
	cn(
		"flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
		active ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
	);

export function SettingsNav({
	active,
	repos,
	reposLoading = false,
	onNavigate,
	onBack,
	searchSlot,
	cloudActive = false,
}: SettingsNavProps) {
	const listed = USER_SETTINGS_PAGES.filter((page) => cloudActive || page.cloudOnly !== true);
	const activeRepoId = active.kind === "repo" ? active.repoId : null;
	const activeKey = settingsTargetKey(active);

	return (
		<aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
			{/* Conductor's Back row is the window's title bar: a drag region beside the traffic lights. */}
			<div
				data-tauri-drag-region
				className="flex h-8 shrink-0 items-center justify-end px-1.5 pt-2"
			>
				<Tooltip content="Esc" side="right">
					<button
						type="button"
						tabIndex={-1}
						onClick={onBack}
						className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-fg-muted transition-colors hover:text-fg"
					>
						<ArrowLeftIcon className="size-4" />
						Back
					</button>
				</Tooltip>
			</div>
			<div className="px-1.5 py-3">{searchSlot}</div>

			<nav aria-label="Settings" className="flex flex-col gap-4 px-1.5 pb-4">
				{GROUPS_BEFORE_REPOSITORIES.map((group) => (
					<div key={group} className="flex flex-col gap-0.5">
						<p className="px-2 pb-1 text-xs text-fg-muted">{SETTINGS_NAV_GROUP_TITLES[group]}</p>
						{listed
							.filter((page) => page.group === group)
							.map((page) => {
								const isActive = activeKey === settingsTargetKey({ kind: "user", page: page.id });
								const Icon = PAGE_ICONS[page.id] ?? SlidersIcon;
								return (
									<button
										key={page.id}
										type="button"
										className={linkClass(isActive)}
										aria-current={isActive ? "page" : undefined}
										onClick={() => onNavigate({ kind: "user", page: page.id })}
									>
										<Icon className="size-4 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{page.title}</span>
									</button>
								);
							})}
					</div>
				))}

				<div className="flex flex-col gap-0.5">
					<p className="px-2 pb-1 text-xs text-fg-muted">Repositories</p>
					{reposLoading ? (
						<p role="status" className="px-2 text-xs text-fg-muted">
							Loading projects…
						</p>
					) : repos.length === 0 ? (
						<p className="px-2 text-xs text-fg-muted">
							No projects yet. Add a project to edit repository settings.
						</p>
					) : (
						repos.map((repo) => {
							const open = repo.id === activeRepoId;
							return (
								<div key={repo.id} className="flex flex-col gap-0.5">
									<button
										type="button"
										className={cn(
											"flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
											open ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
										)}
										aria-expanded={open}
										onClick={() =>
											onNavigate({
												kind: "repo",
												repoId: repo.id as RepoId,
												page: DEFAULT_REPO_SETTINGS_PAGE,
											})
										}
									>
										<span
											aria-hidden="true"
											className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-hover text-3xs font-medium"
										>
											{repo.name.slice(0, 1).toUpperCase() || "?"}
										</span>
										<span className="min-w-0 flex-1 truncate">{repo.name}</span>
									</button>
									{open ? (
										<div className="mt-1 ml-4 flex flex-col gap-1 border-l border-border pl-2">
											{REPO_SETTINGS_PAGES.map((page) => {
												const isActive =
													activeKey ===
													settingsTargetKey({
														kind: "repo",
														repoId: repo.id as RepoId,
														page: page.id,
													});
												const Icon = REPO_PAGE_ICONS[page.id];
												return (
													<button
														key={page.id}
														type="button"
														className={linkClass(isActive)}
														aria-current={isActive ? "page" : undefined}
														onClick={() =>
															onNavigate({ kind: "repo", repoId: repo.id as RepoId, page: page.id })
														}
													>
														<Icon className="size-4 shrink-0" />
														<span className="min-w-0 flex-1 truncate">{page.title}</span>
													</button>
												);
											})}
										</div>
									) : null}
								</div>
							);
						})
					)}
				</div>
				{GROUPS_AFTER_REPOSITORIES.map((group) => (
					<div key={group} className="flex flex-col gap-0.5">
						<p className="px-2 pb-1 text-xs text-fg-muted">{SETTINGS_NAV_GROUP_TITLES[group]}</p>
						{listed
							.filter((page) => page.group === group)
							.map((page) => {
								const isActive = activeKey === settingsTargetKey({ kind: "user", page: page.id });
								const Icon = PAGE_ICONS[page.id] ?? SlidersIcon;
								return (
									<button
										key={page.id}
										type="button"
										className={linkClass(isActive)}
										aria-current={isActive ? "page" : undefined}
										onClick={() => onNavigate({ kind: "user", page: page.id })}
									>
										<Icon className="size-4 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{page.title}</span>
									</button>
								);
							})}
					</div>
				))}
			</nav>
		</aside>
	);
}
