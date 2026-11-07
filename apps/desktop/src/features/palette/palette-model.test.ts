/**
 * @feature NAV-08 Command palette model
 * Owns: tests for the pure groups and items the palette shows for a tab and query.
 * Behaviour: ui-map.md 5.1 (groups, tabs, per-tab placeholders), 5.4 (the command registry feeds the palette).
 * Test first: with two workspaces and the query "fix", only the one named "fix-login" is returned.
 */
import { describe, expect, it } from "vitest";
import type { CommandEntry } from "../../core/api.ts";
import type { Repo, Section, Workspace } from "../../core/model.ts";
import { toCommandEntries } from "../../core/registries/commands.ts";
import {
	buildPaletteGroups,
	buildSectionGroups,
	nextPaletteTab,
	palettePlaceholder,
} from "./palette-model.ts";

const repo = (id: string, name: string): Repo => ({
	id: id as Repo["id"],
	name,
	rootPath: `/code/${id}`,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 0,
	updatedAt: 0,
});

const workspace = (id: string, repoId: string, overrides: Partial<Workspace> = {}): Workspace => ({
	id: id as Workspace["id"],
	repoId: repoId as Workspace["repoId"],
	directoryName: id,
	path: `/code/${id}`,
	branch: `jahala/${id}`,
	branchIsPlaceholder: false,
	host: { kind: "local" },
	// Rows are named as the sidebar names them; this fixture's name is its id.
	displayName: id,
	targetBranch: "origin/main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	notes: null,
	linkedPaths: [],
	prNumber: null,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 0,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const commands = (): CommandEntry[] => toCommandEntries(() => true);

const section = (id: string, name: string, workspaceIds: string[]): Section => ({
	id: id as Section["id"],
	name,
	emoji: null,
	position: 0,
	collapsed: false,
	workspaceIds: workspaceIds as Section["workspaceIds"],
});

const labels = (groups: ReturnType<typeof buildPaletteGroups>, heading: string): string[] =>
	groups.find((group) => group.heading === heading)?.items.map((item) => item.label) ?? [];

describe("NAV-08 palette model", () => {
	it("filters workspaces to the one that matches the query", () => {
		const groups = buildPaletteGroups({
			tab: "all",
			query: "fix",
			workspaces: [workspace("fix-login", "r1"), workspace("payments", "r1")],
			repos: [repo("r1", "conducted")],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]?.heading).toBe("Workspaces");
		expect(groups[0]?.items.map((item) => item.label)).toEqual(["fix-login"]);
	});

	it("lists an archived workspace only under Archived", () => {
		const groups = buildPaletteGroups({
			tab: "workspaces",
			query: "",
			workspaces: [
				workspace("active", "r1"),
				workspace("old", "r1", { state: "archived", archivedAt: 10 }),
			],
			repos: [],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(labels(groups, "Recent workspaces")).toEqual(["active"]);
		expect(labels(groups, "Workspaces")).toEqual(["active"]);
		expect(labels(groups, "Archived")).toEqual(["old"]);
	});

	it("shows workspace actions only when a workspace is open", () => {
		const groups = buildPaletteGroups({
			tab: "actions",
			query: "",
			workspaces: [workspace("w1", "r1")],
			repos: [],
			commands: commands(),
			currentWorkspaceId: "w1",
			branchPrefix: "",
		});
		expect(labels(groups, "Workspace actions")).toEqual([
			"File picker",
			"Search in files",
			"Show changes",
			"Show uncommitted changes",
			"Show all files",
			"Show checks",
			"Link pull request",
			"Link issue",
			"Copy URL",
			"Move to section",
			"Create PR",
			"Open pull request",
			"Merge PR",
			"Ready for review",
			"Fix errors",
			"Archive workspace",
		]);

		const withoutWorkspace = buildPaletteGroups({
			tab: "actions",
			query: "",
			workspaces: [workspace("w1", "r1")],
			repos: [],
			commands: commands(),
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(labels(withoutWorkspace, "Workspace actions")).toEqual([]);
	});

	it("lists the palette actions and navigation commands by their visible labels", () => {
		const groups = buildPaletteGroups({
			tab: "actions",
			query: "",
			workspaces: [],
			repos: [],
			commands: commands(),
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(labels(groups, "Actions")).toEqual([
			"Create workspace",
			"Create section",
			"Add project",
			"Create snippet",
			"Edit snippets",
			"Toggle theme",
			"Toggle left sidebar",
			"Toggle right sidebar",
			"Toggle zen mode",
			"Send feedback",
			"Show keyboard shortcuts",
			"Check for updates",
			"Open changelog",
			"Passport",
		]);
		expect(labels(groups, "Navigation")).toEqual([
			"Go to next unread",
			"Settings",
			"View archived workspaces",
			"Open documentation",
		]);
	});

	it("filters the command groups by the query like every other group", () => {
		const input = {
			tab: "all" as const,
			workspaces: [workspace("w1", "r1")],
			repos: [],
			commands: commands(),
			currentWorkspaceId: "w1",
			branchPrefix: "",
		};
		const updates = buildPaletteGroups({ ...input, query: "check for updates" });
		expect(labels(updates, "Actions")).toEqual(["Check for updates"]);
		expect(labels(updates, "Workspace actions")).toEqual([]);
		expect(labels(updates, "Navigation")).toEqual([]);

		expect(buildPaletteGroups({ ...input, query: "zzzzzz" })).toEqual([]);
	});

	it("lists every settings page and agent provider on the settings tab", () => {
		const groups = buildPaletteGroups({
			tab: "settings",
			query: "",
			workspaces: [],
			repos: [],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(labels(groups, "Settings")).toEqual([
			"General",
			"Account",
			"Appearance",
			"Default models",
			"Git",
			"Agents",
			"Environment",
			"Scripts",
			"Actions",
			"Misc",
			"Experimental",
			"Advanced",
			"Remote control",
			"Claude Code",
			"Codex",
			"Cursor",
			"OpenCode",
			"Pi",
		]);
	});

	it("marks a disabled command and leaves it in its group", () => {
		const entries = commands().map((entry) =>
			entry.id === "workspace.archive" ? { ...entry, enabled: false } : entry,
		);
		const groups = buildPaletteGroups({
			tab: "actions",
			query: "archive",
			workspaces: [workspace("w1", "r1")],
			repos: [],
			commands: entries,
			currentWorkspaceId: "w1",
			branchPrefix: "",
		});
		const archive = groups
			.flatMap((group) => group.items)
			.find((item) => item.label === "Archive workspace");
		expect(archive?.disabled).toBe(true);
	});

	it("puts recent workspaces first when the query is empty", () => {
		const groups = buildPaletteGroups({
			tab: "all",
			query: "",
			workspaces: [
				workspace("older", "r1", { lastActivityAt: 100 }),
				workspace("newer", "r1", { lastActivityAt: 200 }),
			],
			repos: [],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(groups[0]?.heading).toBe("Recent workspaces");
		expect(labels(groups, "Recent workspaces")).toEqual(["newer", "older"]);
	});

	it("keeps one entry per workspace inside a group", () => {
		const duplicate = workspace("same", "r1");
		const groups = buildPaletteGroups({
			tab: "workspaces",
			query: "",
			workspaces: [duplicate, duplicate],
			repos: [],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
		});
		expect(labels(groups, "Workspaces")).toEqual(["same"]);
	});

	it("lists chat groups and open-in apps when the caller supplies them", () => {
		const groups = buildPaletteGroups({
			tab: "all",
			query: "",
			workspaces: [],
			repos: [],
			commands: commands(),
			currentWorkspaceId: "w1",
			branchPrefix: "",
			sessions: [
				{
					id: "s1" as never,
					workspaceId: "w1" as never,
					title: "Fix the login form",
					config: {} as never,
					agentSessionId: null,
					forkResumeNativeMessageId: null,
					unreadCount: 0,
					contextUsedTokens: null,
					contextWindowTokens: null,
					queuePausedAt: null,
					closedAt: null,
					lastUserMessageAt: 10,
					createdAt: 0,
					updatedAt: 0,
				},
			],
			installedApps: ["Finder", "Cursor"],
			defaultOpenInApp: "Cursor",
		});
		expect(labels(groups, "Chats in this workspace")).toEqual(["Fix the login form"]);
		expect(labels(groups, "Open in")).toEqual(["Finder", "Cursor"]);
		const openIn = groups.find((group) => group.heading === "Open in");
		const cursor = openIn?.items.find((item) => item.label === "Cursor");
		expect(cursor?.shortcut).toBe("⌘O");
	});

	it("builds the section sub-page with a remove item only for a placed workspace", () => {
		const sections = [section("sec-1", "Review", ["w1"]), section("sec-2", "Later", [])];
		const placed = buildSectionGroups("", sections, "w1");
		expect(labels(placed, "Sections")).toEqual(["Review", "Later"]);
		expect(labels(placed, "Section actions")).toEqual(["Remove from section"]);

		const notPlaced = buildSectionGroups("", sections, "w2");
		expect(labels(notPlaced, "Section actions")).toEqual([]);
		expect(labels(buildSectionGroups("rev", sections, "w1"), "Sections")).toEqual(["Review"]);
	});

	it("changes the placeholder with the tab and cycles the tabs", () => {
		expect(palettePlaceholder("all")).toBe("Type a command or search...");
		expect(palettePlaceholder("workspaces")).toBe("Search workspaces...");
		expect(palettePlaceholder("projects")).toBe("Search projects...");
		expect(palettePlaceholder("actions")).toBe("Search actions...");
		expect(palettePlaceholder("settings")).toBe("Search settings...");
		expect(nextPaletteTab("all", 1)).toBe("workspaces");
		expect(nextPaletteTab("settings", 1)).toBe("all");
		expect(nextPaletteTab("all", -1)).toBe("settings");
	});
});

describe("NAV-08 palette workspace rows", () => {
	it("names a workspace as the sidebar does and gives recent rows their age", () => {
		const groups = buildPaletteGroups({
			tab: "all",
			query: "",
			workspaces: [
				workspace("w1", "r1", {
					displayName: null,
					prTitle: "Fix the login redirect",
					lastActivityAt: 0,
				}),
			],
			repos: [repo("r1", "conducted")],
			commands: [],
			currentWorkspaceId: null,
			branchPrefix: "",
			now: 86_400_000,
		});
		const [row] = groups.find((group) => group.heading === "Recent workspaces")?.items ?? [];
		expect(row?.label).toBe("Fix the login redirect");
		expect(row?.hint).toBe("1d");
		expect(row?.avatar).toBe("C");
		// All opens on the recent rows only, so a workspace is not listed twice.
		expect(groups.some((group) => group.heading === "Workspaces")).toBe(false);
	});
});
