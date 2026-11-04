/**
 * @feature SET-02 Settings pages and navigation
 * Owns: the list of settings pages, their groups and titles, and the parsing of the route's page
 * string into a typed target.
 * Behaviour: ui-map.md 6, "Navigation": Personal (General, Account, Appearance, Keyboard shortcuts,
 * Default models, Git, Connections), Agents and environment (Agents, Environment), Repositories
 * (Scripts, Actions, Misc per repository; the brief also splits out Prompts), More (Experimental,
 * Advanced). Left out: Organization pages, Remote control (needs a hosted relay), Internal pages,
 * and the Big terminal page (its setting is listed on the Experimental page).
 * Page ids follow Conductor's route names (ui-map.md header: key-bindings). Titles are ours.
 * Our design choice: the router's `$page` is one path segment (app/router.tsx), so a repository page
 * is written "repo:<repoId>:<page>", for example "repo:3f2a:scripts". Ids are UUIDs and never hold
 * a colon.
 * Must handle: an empty string, a trailing colon, a repository page with an empty id, an unknown
 * page (an error result, never a default page), and a page string with extra colons.
 * Test first: parseSettingsPage("repo:abc:scripts") gives kind "repo", repoId "abc", page
 * "scripts"; parseSettingsPage("nope") is an error.
 */
import type { AppError, RepoId, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export type UserSettingsPageId =
	| "general"
	| "account"
	| "appearance"
	| "key-bindings"
	| "default-models"
	| "git"
	| "connections"
	| "agents"
	| "environment"
	| "experimental"
	| "advanced";

export type RepoSettingsPageId = "scripts" | "actions" | "prompts" | "misc";

export type SettingsTarget =
	| { kind: "user"; page: UserSettingsPageId }
	| { kind: "repo"; repoId: RepoId; page: RepoSettingsPageId };

export type SettingsNavGroup = "personal" | "agents_and_environment" | "more";

export const USER_SETTINGS_PAGES: readonly {
	id: UserSettingsPageId;
	title: string;
	group: SettingsNavGroup;
}[] = [
	{ id: "general", title: "General", group: "personal" },
	{ id: "account", title: "Account", group: "personal" },
	{ id: "appearance", title: "Appearance", group: "personal" },
	{ id: "key-bindings", title: "Keyboard shortcuts", group: "personal" },
	{ id: "default-models", title: "Default models", group: "personal" },
	{ id: "git", title: "Git", group: "personal" },
	{ id: "connections", title: "Connections", group: "personal" },
	{ id: "agents", title: "Agents", group: "agents_and_environment" },
	{ id: "environment", title: "Environment", group: "agents_and_environment" },
	{ id: "experimental", title: "Experimental", group: "more" },
	{ id: "advanced", title: "Advanced", group: "more" },
];

export const REPO_SETTINGS_PAGES: readonly { id: RepoSettingsPageId; title: string }[] = [
	{ id: "scripts", title: "Scripts" },
	{ id: "actions", title: "Actions" },
	{ id: "prompts", title: "Prompts" },
	{ id: "misc", title: "Misc" },
];

export function parseSettingsPage(_page: string): Result<SettingsTarget, AppError> {
	return notImplemented("SET-02");
}
