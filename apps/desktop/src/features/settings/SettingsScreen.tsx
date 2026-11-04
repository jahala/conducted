/**
 * @feature SET-02 SettingsScreen
 * Owns: the settings route. A left navigation with search, and the page for `page`. Entry point
 * embedded by the router.
 * Behaviour: ui-map.md 6 (layout: left nav with a search box, Back and Esc to leave, repository
 * picker in the Repositories group; pages by group). Cloud pages (organization, members, cloud
 * computer, remote control) are left out.
 * Data: useRepos for the Repositories group. Each page reads its own data.
 * Children: SettingsNav, SettingsSearch, one page component per UserSettingsPageId and
 * RepoSettingsPageId (pages/*.tsx, repo/*.tsx).
 * Our design choice: `page` is "general", "account", "key-bindings", ... for user pages and
 * "repo:<repoId>:<page>" for repository pages (one path segment, as app/router.tsx has it), parsed
 * by parseSettingsPage. Repository pages are linked from SettingsNav, so the router needs no change.
 * Must handle: an unknown page string (designed "page not found" state with a link to General),
 * a repository id that no longer exists, repositories still loading, Esc and the Back button
 * leaving to the last workspace, a search result opening its page and scrolling to the setting,
 * and deep links to one setting.
 * Test first: page "git" renders the Git page, and "nope" renders the page-not-found state.
 */
import { notImplemented } from "@conducted/shared";

export function SettingsScreen(_props: { page: string }): never {
	return notImplemented("SET-02");
}
