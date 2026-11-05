/**
 * @feature SET-02 Settings search function
 * Owns: the pure fuzzy search over the settings index, and the index built from the settings and
 * command registries.
 * Behaviour: ui-map.md 6 (fuzzy over all setting labels, descriptions and keywords, top 30
 * results). Conductor shares one fuzzy utility between settings search and pickers (ui-map.md 8);
 * this file calls the app's shared matcher rather than writing a second one.
 * Our design choice: title matches rank above description matches, which rank above keyword
 * matches; ties keep registry order. Commands are searchable too, so the shortcuts page can be
 * reached from search. They are listed after every matching setting, because Conductor's search
 * covers settings only, and Enter on "zoom" opens App zoom rather than the Zoom in shortcut.
 * Must handle: an empty or blank query (empty result), upper and lower case, accents, a query with
 * several words (all must match somewhere), a limit of zero, and an index with duplicate titles on
 * different pages.
 * Test first: with titles "App zoom" and "Code theme", the query "zom" returns only "App zoom".
 */
import { rankFuzzy } from "../../core/fuzzy.ts";
import { COMMANDS } from "../../core/registries/commands.ts";
import { SETTINGS, type SettingPage } from "../../core/registries/settings.ts";
import type { RepoSettingsPageId, UserSettingsPageId } from "./settings-pages.ts";

export interface SearchableSetting {
	/** The registry key. */
	key: string;
	title: string;
	description: string;
	keywords: readonly string[];
	page: UserSettingsPageId | { repoPage: RepoSettingsPageId };
}

const USER_PAGE_OF: Partial<Record<SettingPage, UserSettingsPageId>> = {
	general: "general",
	account: "account",
	appearance: "appearance",
	models: "default-models",
	git: "git",
	agents: "agents",
	environment: "environment",
	experimental: "experimental",
	advanced: "advanced",
};

const REPO_PAGE_OF: Partial<Record<SettingPage, RepoSettingsPageId>> = {
	scripts: "scripts",
	actions: "actions",
	misc: "misc",
};

/** The key prefix of a command's entry, which opens the shortcuts page. */
const COMMAND_KEY_PREFIX = "command:";

const isCommand = (entry: SearchableSetting): boolean => entry.key.startsWith(COMMAND_KEY_PREFIX);

const WEIGHTED_FIELDS = [
	{ text: (setting: SearchableSetting) => setting.title, weight: 3 },
	{ text: (setting: SearchableSetting) => setting.description, weight: 2 },
	{ text: (setting: SearchableSetting) => setting.keywords.join(" "), weight: 1 },
] as const;

/** Every setting and command that can be found by search, in registry order. */
export function buildSettingsIndex(): SearchableSetting[] {
	const index: SearchableSetting[] = [];
	for (const setting of SETTINGS) {
		if (setting.page === "state") continue;
		const userPage = USER_PAGE_OF[setting.page];
		const repoPage = REPO_PAGE_OF[setting.page];
		const common = {
			key: setting.key,
			title: setting.title,
			description: setting.description,
			keywords: setting.searchTerms,
		};
		if (repoPage !== undefined) {
			index.push({ ...common, page: { repoPage } });
		} else if (userPage !== undefined) {
			index.push({ ...common, page: userPage });
		}
	}
	for (const command of COMMANDS) {
		index.push({
			key: `${COMMAND_KEY_PREFIX}${command.id}`,
			title: command.title,
			description: command.category,
			keywords: ["shortcut", "key binding", command.category],
			page: "key-bindings",
		});
	}
	return index;
}

export function searchSettings(
	index: readonly SearchableSetting[],
	query: string,
	limit: number,
): SearchableSetting[] {
	if (query.trim() === "" || limit <= 0) {
		return [];
	}
	const rank = (entries: readonly SearchableSetting[]) =>
		rankFuzzy(entries, query, WEIGHTED_FIELDS, limit).map((ranked) => ranked.item);
	const settings = rank(index.filter((entry) => !isCommand(entry)));
	const commands = rank(index.filter(isCommand));
	return [...settings, ...commands].slice(0, limit);
}
