/**
 * @feature NAV-08 Command palette model
 * Owns: the pure function that builds the palette's groups and items from workspaces, repos, commands, settings
 * pages and the current workspace, for the current tab and query. Also the tab order and the per-tab
 * placeholder.
 * Behaviour: ui-map.md 5.1 (groups and items, tabs, placeholders), 5.4 (the command registry feeds the palette).
 * Our design choice: pure, so it is tested without React. Ranking uses the shared fuzzy matcher from
 * core/fuzzy.ts. Item ids carry a prefix (`workspace:`, `project:`, `chat:`, `settings:`, `open-in:`,
 * `section:`) so the screen knows how to act on a result; command ids stay unchanged.
 * Must handle: empty query (recent items first); a query with no matches (empty result, not an error); the
 * same workspace never appears twice in one group; archived workspaces only under Archived; commands whose
 * `enabled` is false are marked disabled; groups that would be empty are left out.
 * Test first: with two workspaces and the query "fix", only the one named "fix-login" is returned, under
 * Workspaces.
 */

import type { CommandEntry } from "../../core/api.ts";
import { rankFuzzy } from "../../core/fuzzy.ts";
import type { Repo, Section, Session, Workspace } from "../../core/model.ts";
import { SETTING_PAGES, type SettingPage } from "../../core/registries/settings.ts";
import { relativeTime } from "../sidebar/WorkspaceRow.tsx";
import { workspaceName } from "../workspace/workspace-name.ts";

export type PaletteTab = "all" | "workspaces" | "projects" | "actions" | "settings";

export const PALETTE_TABS: readonly PaletteTab[] = [
	"all",
	"workspaces",
	"projects",
	"actions",
	"settings",
];

export interface PaletteItem {
	id: string;
	label: string;
	/** The project's mark for a workspace row (its icon or first letter). */
	avatar?: string;
	hint: string | null;
	shortcut: string | null;
	disabled: boolean;
}

export interface PaletteGroup {
	heading: string;
	items: PaletteItem[];
}

export interface PaletteInput {
	tab: PaletteTab;
	query: string;
	workspaces: Workspace[];
	repos: Repo[];
	commands: CommandEntry[];
	currentWorkspaceId: string | null;
	sessions?: readonly Session[];
	installedApps?: readonly string[];
	defaultOpenInApp?: string | null;
	/** The current time, for the age of a recent workspace ("1d"). */
	now?: number;
}

interface CommandSpec {
	commandId: string;
	label: string;
}

const WORKSPACE_ACTIONS: readonly CommandSpec[] = [
	{ commandId: "nav.quickOpenFile", label: "File picker" },
	{ commandId: "nav.searchInFiles", label: "Search in files" },
	{ commandId: "review.showChanges", label: "Show changes" },
	{ commandId: "review.showUncommitted", label: "Show uncommitted changes" },
	{ commandId: "review.showAllFiles", label: "Show all files" },
	{ commandId: "pr.showChecks", label: "Show checks" },
	{ commandId: "chat.linkIssue", label: "Link issue" },
	{ commandId: "workspace.copyLink", label: "Copy URL" },
	{ commandId: "workspace.moveToSection", label: "Move to section" },
	{ commandId: "git.createPr", label: "Create PR" },
	{ commandId: "pr.open", label: "Open pull request" },
	{ commandId: "pr.merge", label: "Merge PR" },
	{ commandId: "pr.markReady", label: "Ready for review" },
	{ commandId: "pr.fixErrors", label: "Fix errors" },
	{ commandId: "workspace.archive", label: "Archive workspace" },
];

const ACTIONS: readonly CommandSpec[] = [
	{ commandId: "workspace.create", label: "Create workspace" },
	{ commandId: "workspace.createSection", label: "Create section" },
	{ commandId: "project.add", label: "Add project" },
	{ commandId: "app.toggleTheme", label: "Toggle theme" },
	{ commandId: "view.toggleLeftSidebar", label: "Toggle left sidebar" },
	{ commandId: "view.toggleRightSidebar", label: "Toggle right sidebar" },
	{ commandId: "view.toggleZenMode", label: "Toggle zen mode" },
	{ commandId: "app.showShortcuts", label: "Show keyboard shortcuts" },
	{ commandId: "app.checkForUpdates", label: "Check for updates" },
	{ commandId: "app.openChangelog", label: "Open changelog" },
	{ commandId: "app.openPassport", label: "Passport" },
];

const NAVIGATION: readonly CommandSpec[] = [
	{ commandId: "nav.nextUnread", label: "Go to next unread" },
	{ commandId: "app.openSettings", label: "Settings" },
	{ commandId: "nav.viewArchived", label: "View archived workspaces" },
	{ commandId: "app.openDocumentation", label: "Open documentation" },
];

const SETTING_PAGE_LABELS: Readonly<Record<Exclude<SettingPage, "state">, string>> = {
	general: "General",
	account: "Account",
	appearance: "Appearance",
	models: "Default models",
	git: "Git",
	agents: "Agents",
	environment: "Environment",
	scripts: "Scripts",
	actions: "Actions",
	misc: "Misc",
	experimental: "Experimental",
	advanced: "Advanced",
	"remote-control": "Remote control",
};

const PROVIDERS: readonly { id: string; label: string }[] = [
	{ id: "claude", label: "Claude Code" },
	{ id: "codex", label: "Codex" },
	{ id: "cursor", label: "Cursor" },
	{ id: "opencode", label: "OpenCode" },
	{ id: "pi", label: "Pi" },
];

const GROUP_ORDER = [
	"Recent workspaces",
	"Workspaces",
	"Archived",
	"Chats in this workspace",
	"Projects",
	"Workspace actions",
	"Actions",
	"Navigation",
	"Settings",
	"Open in",
	"Sections",
	"Section actions",
] as const;

function rankItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
	if (query.trim() === "") return [...items];
	return rankFuzzy(
		items,
		query,
		[
			{ text: (item) => item.label, weight: 3 },
			{ text: (item) => item.hint ?? "", weight: 1 },
		],
		100,
	).map((ranked) => ranked.item);
}

function uniqueWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
	const seen = new Set<string>();
	const result: Workspace[] = [];
	for (const workspace of workspaces) {
		if (seen.has(workspace.id)) continue;
		seen.add(workspace.id);
		result.push(workspace);
	}
	return result;
}

/**
 * A workspace row, named as the sidebar names it (user-set name, then pull request title, then branch).
 * Recent rows show the workspace's age as Conductor does ("1d"); other rows the project's name.
 */
function workspaceItem(
	workspace: Workspace,
	reposById: ReadonlyMap<string, Repo>,
	now?: number,
): PaletteItem {
	const repo = reposById.get(workspace.repoId);
	const icon = repo?.icon?.trim();
	return {
		id: `workspace:${workspace.id}`,
		label: workspaceName(workspace),
		avatar:
			icon !== undefined && icon !== "" ? icon : (repo?.name.slice(0, 1).toUpperCase() ?? "?"),
		hint:
			now === undefined
				? (repo?.name ?? workspace.branch)
				: relativeTime(workspace.lastActivityAt, now),
		shortcut: null,
		disabled: false,
	};
}

function commandItems(
	specs: readonly CommandSpec[],
	commandsById: ReadonlyMap<string, CommandEntry>,
): PaletteItem[] {
	const items: PaletteItem[] = [];
	for (const spec of specs) {
		const entry = commandsById.get(spec.commandId);
		if (entry === undefined) continue;
		items.push({
			id: entry.id,
			label: spec.label,
			hint: entry.category,
			shortcut: entry.shortcut,
			disabled: !entry.enabled,
		});
	}
	return items;
}

function settingsItems(): PaletteItem[] {
	const pageItems: PaletteItem[] = SETTING_PAGES.filter(
		(page): page is Exclude<SettingPage, "state"> => page !== "state",
	).map((page) => ({
		id: `settings:${page}`,
		label: SETTING_PAGE_LABELS[page],
		hint: "Settings",
		shortcut: null,
		disabled: false,
	}));
	const providerItems: PaletteItem[] = PROVIDERS.map((provider) => ({
		id: `settings:agents:${provider.id}`,
		label: provider.label,
		hint: "Agent provider",
		shortcut: null,
		disabled: false,
	}));
	return [...pageItems, ...providerItems];
}

function groupOrdered(groups: PaletteGroup[]): PaletteGroup[] {
	return [...groups].sort(
		(left, right) =>
			GROUP_ORDER.indexOf(left.heading as (typeof GROUP_ORDER)[number]) -
			GROUP_ORDER.indexOf(right.heading as (typeof GROUP_ORDER)[number]),
	);
}

export function buildPaletteGroups(props: PaletteInput): PaletteGroup[] {
	const query = props.query;
	const reposById = new Map(props.repos.map((repo) => [repo.id, repo]));
	const commandsById = new Map(props.commands.map((entry) => [entry.id, entry]));
	const workspaces = uniqueWorkspaces(props.workspaces);
	const active = workspaces.filter((workspace) => workspace.state !== "archived");
	const archived = workspaces.filter((workspace) => workspace.state === "archived");
	const groups: PaletteGroup[] = [];

	const addGroup = (heading: string, items: PaletteItem[]) => {
		const ranked = rankItems(items, query);
		if (ranked.length > 0) groups.push({ heading, items: ranked });
	};

	const recent = [...active]
		.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
		.slice(0, 5)
		.map((workspace) => workspaceItem(workspace, reposById, props.now));
	const browsing = query.trim() === "";
	if (browsing) addGroup("Recent workspaces", recent);
	// Conductor's All tab opens on the recent workspaces only; the full lists come with a query or on
	// the Workspaces tab, so All does not show the same workspaces twice.
	if (!(browsing && props.tab === "all")) {
		addGroup(
			"Workspaces",
			active.map((workspace) => workspaceItem(workspace, reposById)),
		);
		addGroup(
			"Archived",
			archived.map((workspace) => workspaceItem(workspace, reposById)),
		);
	}

	if (props.currentWorkspaceId !== null && props.sessions !== undefined) {
		addGroup(
			"Chats in this workspace",
			props.sessions.map((session) => ({
				id: `chat:${session.id}`,
				label: session.title ?? "New chat",
				hint: session.closedAt === null ? "Open chat" : "Closed chat",
				shortcut: null,
				disabled: false,
			})),
		);
	}

	addGroup(
		"Projects",
		props.repos.map((repo) => ({
			id: `project:${repo.id}`,
			label: repo.name,
			hint: repo.rootPath,
			shortcut: null,
			disabled: false,
		})),
	);

	if (props.currentWorkspaceId !== null) {
		addGroup("Workspace actions", commandItems(WORKSPACE_ACTIONS, commandsById));
	}
	addGroup("Actions", commandItems(ACTIONS, commandsById));
	addGroup("Navigation", commandItems(NAVIGATION, commandsById));
	addGroup("Settings", settingsItems());

	if (props.installedApps !== undefined && props.installedApps.length > 0) {
		const defaultShortcut = commandsById.get("workspace.openIn")?.shortcut ?? null;
		addGroup(
			"Open in",
			props.installedApps.map((appName) => ({
				id: `open-in:${appName}`,
				label: appName,
				hint: appName === props.defaultOpenInApp ? "Default app" : "Open in",
				shortcut: appName === props.defaultOpenInApp ? defaultShortcut : null,
				disabled: false,
			})),
		);
	}

	const order = groupOrdered(groups);
	switch (props.tab) {
		case "workspaces":
			return order.filter((group) =>
				["Recent workspaces", "Workspaces", "Archived", "Chats in this workspace"].includes(
					group.heading,
				),
			);
		case "projects":
			return order.filter((group) => group.heading === "Projects");
		case "actions":
			return order.filter((group) =>
				["Workspace actions", "Actions", "Navigation", "Open in"].includes(group.heading),
			);
		case "settings":
			return order.filter((group) => group.heading === "Settings");
		case "all":
			return order.filter(
				(group) => group.heading !== "Sections" && group.heading !== "Section actions",
			);
	}
}

export function buildSectionGroups(
	query: string,
	sections: readonly Section[],
	currentWorkspaceId: string | null,
): PaletteGroup[] {
	const items: PaletteItem[] = sections.map((section) => ({
		id: `section:${section.id}`,
		label: section.emoji === null ? section.name : `${section.emoji} ${section.name}`,
		hint: "Section",
		shortcut: null,
		disabled: false,
	}));
	const ranked = rankItems(items, query);
	const groups: PaletteGroup[] = [];
	if (ranked.length > 0) groups.push({ heading: "Sections", items: ranked });
	const inSection =
		currentWorkspaceId !== null &&
		sections.some((section) => section.workspaceIds.some((id) => id === currentWorkspaceId));
	if (inSection) {
		const remove: PaletteItem = {
			id: "section:none",
			label: "Remove from section",
			hint: "Section actions",
			shortcut: null,
			disabled: false,
		};
		const [match] = rankItems([remove], query);
		if (match !== undefined) groups.push({ heading: "Section actions", items: [match] });
	}
	return groups;
}

export function palettePlaceholder(tab: PaletteTab): string {
	switch (tab) {
		case "workspaces":
			return "Search workspaces...";
		case "projects":
			return "Search projects...";
		case "actions":
			return "Search actions...";
		case "settings":
			return "Search settings...";
		case "all":
			return "Type a command or search...";
	}
}

export function nextPaletteTab(tab: PaletteTab, direction: 1 | -1): PaletteTab {
	const index = PALETTE_TABS.indexOf(tab);
	const next = (index + direction + PALETTE_TABS.length) % PALETTE_TABS.length;
	return PALETTE_TABS[next] ?? "all";
}
