import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { createLookups, defaultSessionConfig } from "./lookups.ts";
import type { Repo, RepoConfig, Session, Workspace } from "./model.ts";
import { getSettingDef } from "./registries/settings.ts";
import type { RepoState } from "./services/repo.ts";
import type { SessionsState } from "./services/sessions.ts";
import type { WorkspaceState } from "./services/workspace.ts";

const repo: Repo = {
	id: "r1" as RepoId,
	name: "app",
	rootPath: "/repos/app",
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
};
const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: repo.id,
	directoryName: "oslo",
	path: "/ws/oslo",
	branch: "me/oslo",
	branchIsPlaceholder: true,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "upstream/dev",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	notes: null,
	linkedPaths: ["/extra"],
	prNumber: 7,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
};

const repoConfig = (createPr: string | null, remoteName: string | null = null): RepoConfig => ({
	setupScript: null,
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate: null,
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName,
	prompts: {
		general: null,
		codeReview: null,
		createPr,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
});

const makeLookups = (
	withRepo = true,
	configs: Record<string, RepoConfig> = {},
	workspaceOverrides: Partial<Workspace> = {},
) => {
	const row = { ...workspace, ...workspaceOverrides };
	return createLookups({
		workspaces: () =>
			createStore<WorkspaceState>(() => ({
				loaded: true,
				backlogLoaded: true,
				backlogById: {},
				workspacesById: { [row.id]: row },
				setup: {},
				archiving: {},
			})),
		repos: () =>
			createStore<RepoState>(() => ({
				loaded: true,
				reposById: withRepo ? { [repo.id]: repo } : {},
				order: [],
				configs,
			})),
		sessions: () =>
			createStore<SessionsState>(() => ({
				loaded: true,
				sessions: { s1: { id: "s1" as SessionId, workspaceId: workspace.id } as Session },
				byWorkspace: {},
				liveStates: {},
				cancelling: {},
				events: {},
				progress: {},
				sending: {},
				openInteractions: {},
				viewingSessionId: null,
			})),
	});
};

describe("createLookups", () => {
	it("builds the git context from the stores", () => {
		const result = makeLookups(true, {
			[repo.id]: repoConfig(null, "origin"),
		}).gitContext("w1" as WorkspaceId);
		expect(result).toEqual({
			ok: true,
			value: {
				workspaceId: "w1",
				workspacePath: "/ws/oslo",
				repoRootPath: "/repos/app",
				remote: "origin",
				targetBranch: "upstream/dev",
				branch: "me/oslo",
			},
		});
	});
	it("returns error values for unknown ids", () => {
		const lookups = makeLookups();
		expect(lookups.workspace("nope" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "workspace_unknown" },
		});
		expect(lookups.workspaceOfSession("nope" as SessionId)).toMatchObject({
			ok: false,
			error: { code: "session_unknown" },
		});
		expect(makeLookups(false).repoOf("w1" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "repo_unknown" },
		});
	});
	it("lists the workspace folder and linked folders as allowed roots", () => {
		expect(makeLookups().allowedRoots("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: ["/ws/oslo", "/extra"],
		});
	});
	it("tells the sidecar about the placeholder branch and port", () => {
		const result = makeLookups().sidecarContext("w1" as WorkspaceId, undefined);
		expect(result).toMatchObject({
			ok: true,
			value: { placeholderBranch: true, port: 55_000, targetBranch: "upstream/dev" },
		});
	});
});

describe("DATA-09 one home for a repository's remote", () => {
	const lookupsWith = (remoteName: string | null, targetBranch = "upstream/dev") =>
		makeLookups(true, { [repo.id]: repoConfig(null, remoteName) }, { targetBranch });

	it("reads the remote name from the repo setting", () => {
		expect(lookupsWith("upstream").remoteNameOf("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: "upstream",
		});
	});

	it("trims the configured name and falls back to origin when it is empty", () => {
		expect(lookupsWith("  fork  ").remoteNameOf("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: "fork",
		});
		expect(lookupsWith("").remoteNameOf("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: "origin",
		});
		expect(lookupsWith("   ").remoteNameOf("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: "origin",
		});
		expect(lookupsWith(null).remoteNameOf("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: "origin",
		});
	});

	it("refuses a configured remote name git could read as an option", () => {
		const lookups = lookupsWith("--upload-pack=x");
		for (const result of [
			lookups.remoteNameOf("w1" as WorkspaceId),
			lookups.gitContext("w1" as WorkspaceId),
			lookups.prContext("w1" as WorkspaceId),
		]) {
			expect(result).toMatchObject({
				ok: false,
				error: { code: "workspace_branch_invalid" },
			});
		}
	});

	it("refuses to guess a remote before the config is loaded", () => {
		expect(makeLookups().remoteNameOf("w1" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "repo_config_unloaded" },
		});
	});

	it("returns an error for an unknown workspace", () => {
		expect(lookupsWith("origin").remoteNameOf("nope" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "workspace_unknown" },
		});
	});

	it("gives gitContext the configured remote, not the target branch's prefix", () => {
		expect(lookupsWith("origin").gitContext("w1" as WorkspaceId)).toMatchObject({
			ok: true,
			value: { remote: "origin", targetBranch: "upstream/dev" },
		});
		expect(lookupsWith("fork").gitContext("w1" as WorkspaceId)).toMatchObject({
			ok: true,
			value: { remote: "fork" },
		});
	});

	it("gives prContext the configured remote, not the target branch's prefix", () => {
		expect(lookupsWith("upstream").prContext("w1" as WorkspaceId)).toMatchObject({
			ok: true,
			value: { remote: "upstream" },
		});
	});

	it("refuses to build a git or PR context before the config is loaded", () => {
		const lookups = makeLookups();
		expect(lookups.gitContext("w1" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "repo_config_unloaded" },
		});
		expect(lookups.prContext("w1" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "repo_config_unloaded" },
		});
	});
});

describe("PR-02 custom prompt from the loaded repo config", () => {
	it("returns the repo's Create PR prompt once its config is loaded", () => {
		const result = makeLookups(true, { [repo.id]: repoConfig("Use the release notes.") }).prContext(
			"w1" as WorkspaceId,
		);

		expect(result).toMatchObject({
			ok: true,
			value: { workspaceId: "w1", customPrompt: "Use the release notes." },
		});
	});

	it("refuses to guess a Create PR prompt before the config is loaded", () => {
		const result = makeLookups().prContext("w1" as WorkspaceId);

		expect(result).toMatchObject({
			ok: false,
			error: { code: "repo_config_unloaded" },
		});
	});

	it("keeps an empty Create PR prompt as null", () => {
		const result = makeLookups(true, { [repo.id]: repoConfig(null) }).prContext(
			"w1" as WorkspaceId,
		);

		expect(result).toMatchObject({ ok: true, value: { customPrompt: null } });
	});
});

describe("defaultSessionConfig", () => {
	// An unset key reads as its registry default, as the real settings service answers.
	const settingsOf =
		(values: Record<string, unknown>) =>
		<T>(key: string): T =>
			(values[key] ?? getSettingDef(key)?.default ?? "") as T;

	it("takes the effort level from settings", () => {
		const result = defaultSessionConfig(
			"w1" as WorkspaceId,
			makeLookups(),
			settingsOf({ default_claude_effort_level: "max", default_model: "opus" }),
		);
		expect(result).toMatchObject({ ok: true, value: { effort: "max", model: "opus" } });
	});

	it("refuses an effort level a chat cannot use instead of passing it on", () => {
		const result = defaultSessionConfig(
			"w1" as WorkspaceId,
			makeLookups(),
			settingsOf({ default_claude_effort_level: "turbo" }),
		);
		expect(result).toMatchObject({ ok: false, error: { code: "setting_invalid" } });
	});

	it("fails for an unknown workspace", () => {
		const result = defaultSessionConfig("nope" as WorkspaceId, makeLookups(), settingsOf({}));
		expect(result).toMatchObject({ ok: false, error: { code: "workspace_unknown" } });
	});

	it("AGENT-16 carries the chat options the settings choose", () => {
		const result = defaultSessionConfig(
			"w1" as WorkspaceId,
			makeLookups(),
			settingsOf({
				default_claude_personality: "concise",
				chrome_mode_enabled: true,
				default_codex_personality: "friendly",
				codex_tool_approval_policy: "always_approve",
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			value: {
				claudeOutputStyle: "concise",
				claudeInChrome: true,
				codexPersonality: "friendly",
				codexApprovalPolicy: "never",
			},
		});
	});

	it("AGENT-16 leaves the chat options out at their defaults", () => {
		const result = defaultSessionConfig("w1" as WorkspaceId, makeLookups(), settingsOf({}));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.claudeOutputStyle).toBeUndefined();
		expect(result.value.claudeInChrome).toBeUndefined();
		expect(result.value.codexPersonality).toBeUndefined();
		expect(result.value.codexApprovalPolicy).toBeUndefined();
	});

	it("RC-04 a new chat takes its Remote Control switch from settings", () => {
		const on = defaultSessionConfig(
			"w1" as WorkspaceId,
			makeLookups(),
			settingsOf({ remote_control_new_chats: true }),
		);
		expect(on).toMatchObject({ ok: true, value: { remoteControl: true } });
		const off = defaultSessionConfig("w1" as WorkspaceId, makeLookups(), settingsOf({}));
		expect(off.ok && off.value.remoteControl).toBeFalsy();
	});

	it("AGENT-16 refuses an output style no chat can use instead of dropping it", () => {
		const result = defaultSessionConfig(
			"w1" as WorkspaceId,
			makeLookups(),
			settingsOf({ default_claude_personality: "shouty" }),
		);
		expect(result).toMatchObject({ ok: false, error: { code: "setting_invalid" } });
	});
});
