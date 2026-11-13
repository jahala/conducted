/**
 * @feature SET-02 Settings pages and navigation
 * Owns: the list of settings pages, their groups and titles, and the parsing of the route's page
 * string into a typed target.
 * Behaviour: ui-map.md 6, "Navigation": Personal (General, Account, Appearance, Keyboard shortcuts,
 * Default models, Git), Agents and environment (Agents, Environment), Repositories, More
 * (Experimental, Advanced), in that order. A repository's sections are Conductor's (renderApp m5e
 * and cdi): Git, Environment, Scripts, Actions and Misc, in that order; a repository opens at
 * Environment (renderApp eWe). The custom instructions are rows of its Actions section.
 * Page ids follow Conductor's route names (ui-map.md header: key-bindings). Titles are ours.
 * While a cloud organisation is active, Conductor adds its organisation pages to Agents &
 * environment (renderApp `fY` list @11775268); of those, MCP is ours (CLOUD-17), after Cloud,
 * which holds what Conductor's organisation Environment page does. Its address works either way.
 * Our design choice: Conductor shows its "Remote control" page only for local organisations; ours
 * (RC-04) is always there, under Agents & environment, since it is about agent chats. Connections
 * (the local port range) is ours too; Conductor has no such page, so it sits in More after Advanced,
 * with the other rarely changed, technical pages (D098).
 * Our design choice: the settings screen takes one page string, so a repository page is written
 * "repo:<repoId>:<page>", for example "repo:3f2a:scripts". The router's repository settings route
 * (`/settings/repos/$repoId/$page`, app/router.tsx) builds that string. Ids are UUIDs and never hold
 * a colon.
 * Must handle: an empty string, a trailing colon, a repository page with an empty id, an unknown
 * page (an error result, never a default page), and a page string with extra colons.
 * Test first: parseSettingsPage("repo:abc:scripts") gives kind "repo", repoId "abc", page
 * "scripts"; parseSettingsPage("nope") is an error.
 */
import { type AppError, appError, err, ok, type RepoId, type Result } from "@conducted/shared";

export type UserSettingsPageId =
	| "general"
	| "account"
	| "appearance"
	| "key-bindings"
	| "models"
	| "git"
	| "connections"
	| "agents"
	| "environment"
	| "cloud"
	| "mcp"
	| "remote-control"
	| "experimental"
	| "advanced";

export type RepoSettingsPageId = "git" | "environment" | "scripts" | "actions" | "misc";

export type SettingsTarget =
	| { kind: "user"; page: UserSettingsPageId }
	| { kind: "repo"; repoId: RepoId; page: RepoSettingsPageId };

export type SettingsNavGroup = "personal" | "agents_and_environment" | "more";

export const USER_SETTINGS_PAGES: readonly {
	id: UserSettingsPageId;
	title: string;
	group: SettingsNavGroup;
	/** Listed only while the cloud organisation is active, as Conductor lists its organisation pages. */
	cloudOnly?: true;
}[] = [
	{ id: "general", title: "General", group: "personal" },
	{ id: "account", title: "Account", group: "personal" },
	{ id: "appearance", title: "Appearance", group: "personal" },
	{ id: "key-bindings", title: "Keyboard shortcuts", group: "personal" },
	{ id: "models", title: "Default models", group: "personal" },
	{ id: "git", title: "Git", group: "personal" },
	{ id: "agents", title: "Agents", group: "agents_and_environment" },
	{ id: "environment", title: "Environment", group: "agents_and_environment" },
	{ id: "cloud", title: "Cloud", group: "agents_and_environment" },
	{ id: "mcp", title: "MCP", group: "agents_and_environment", cloudOnly: true },
	{ id: "remote-control", title: "Remote control", group: "agents_and_environment" },
	{ id: "experimental", title: "Experimental", group: "more" },
	{ id: "advanced", title: "Advanced", group: "more" },
	{ id: "connections", title: "Connections", group: "more" },
];

export const REPO_SETTINGS_PAGES: readonly { id: RepoSettingsPageId; title: string }[] = [
	{ id: "git", title: "Git" },
	{ id: "environment", title: "Environment" },
	{ id: "scripts", title: "Scripts" },
	{ id: "actions", title: "Actions" },
	{ id: "misc", title: "Misc" },
];

/** The section a repository opens at, as in Conductor. */
export const DEFAULT_REPO_SETTINGS_PAGE: RepoSettingsPageId = "environment";

export const SETTINGS_NAV_GROUP_TITLES: Readonly<Record<SettingsNavGroup, string>> = {
	personal: "Personal",
	agents_and_environment: "Agents & environment",
	more: "More",
};

const USER_PAGE_IDS = new Set<string>(USER_SETTINGS_PAGES.map((page) => page.id));
const REPO_PAGE_IDS = new Set<string>(REPO_SETTINGS_PAGES.map((page) => page.id));

export function isUserSettingsPageId(value: string): value is UserSettingsPageId {
	return USER_PAGE_IDS.has(value);
}

export function isRepoSettingsPageId(value: string): value is RepoSettingsPageId {
	return REPO_PAGE_IDS.has(value);
}

const unknownPage = (page: string): AppError =>
	appError("settings_page_unknown", `There is no settings page called "${page}".`);

/**
 * Parses one segment of the settings route. A user page is its id; a repository page is
 * "repo:<repoId>:<page>". A page nobody knows is an error, so the screen can show its designed
 * not-found state instead of falling back to General.
 */
export function parseSettingsPage(page: string): Result<SettingsTarget, AppError> {
	const value = page.trim();
	if (value === "") {
		return err(appError("settings_page_missing", "Choose a settings page."));
	}
	if (value.startsWith("repo:")) {
		const parts = value.slice("repo:".length).split(":");
		if (parts.length !== 2) {
			return err(unknownPage(page));
		}
		const [repoId, repoPage] = parts;
		if (repoId === undefined || repoId === "") {
			return err(appError("settings_page_repo_missing", "Choose a project for this page."));
		}
		if (repoPage === undefined || !isRepoSettingsPageId(repoPage)) {
			return err(unknownPage(page));
		}
		return ok({ kind: "repo", repoId: repoId as RepoId, page: repoPage });
	}
	if (value.includes(":")) {
		return err(unknownPage(page));
	}
	if (!isUserSettingsPageId(value)) {
		return err(unknownPage(page));
	}
	return ok({ kind: "user", page: value });
}

/** A stable key for the active target, for comparisons in the navigation. */
export function settingsTargetKey(target: SettingsTarget): string {
	return target.kind === "user" ? target.page : `repo:${target.repoId}:${target.page}`;
}
