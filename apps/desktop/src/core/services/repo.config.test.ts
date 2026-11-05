import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Dialogs, FileSystem, Opener } from "../../platform/platform.ts";
import { localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import type { RepoRepository } from "../db/repos.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo } from "../model.ts";
import { RepoService, type RepoServiceDeps } from "./repo.ts";
import {
	parseSettingsDocument,
	type SettingsFileContents,
	type SettingsService,
} from "./settings.ts";
import { tomlCodec } from "./toml-codec.ts";

const repoId = "repo-1" as RepoId;
const rootPath = "/code/app";
const sharedPath = sharedSettingsFile(rootPath);
const localPath = localSettingsFile(rootPath);

interface Harness {
	service: RepoService;
	files: Map<string, string>;
	focus: (focused: boolean) => void;
	config: () => ReturnType<RepoService["store"]["getState"]>["configs"][string] | undefined;
}

function makeService(options: { withWindow?: boolean; repo?: Repo | null } = {}): Harness {
	const files = new Map<string, string>();
	let focusListener: ((focused: boolean) => void) | null = null;
	const repo =
		options.repo === undefined
			? {
					id: repoId,
					name: "app",
					rootPath,
					remoteUrl: null,
					defaultBranch: "main",
					icon: null,
					displayOrder: 0,
					hidden: false,
					createdAt: 1,
					updatedAt: 1,
				}
			: options.repo;

	const fs = {
		async readText(path: string) {
			const text = files.get(path);
			return text === undefined ? err(appError("fs_missing", "missing")) : ok(text);
		},
		async writeTextAtomic(path: string, text: string) {
			files.set(path, text);
			return ok(undefined);
		},
		async exists(path: string) {
			return files.has(path);
		},
		async stat() {
			return err(appError("fs_stat", "not used"));
		},
		async mkdirp() {
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash() {
			return ok(undefined);
		},
		paths: { home: "/home/me", appData: "/app", temp: "/tmp", resources: "/resources" },
	} as unknown as FileSystem;

	const platform = {
		fs,
		dialogs: {} as Dialogs,
		opener: {} as Opener,
		...(options.withWindow === true
			? {
					window: {
						onFocusChanged(listener: (focused: boolean) => void) {
							focusListener = listener;
							return () => {
								focusListener = null;
							};
						},
					},
				}
			: {}),
	} as RepoServiceDeps["platform"];

	const empty = (file: string): SettingsFileContents => ({
		file,
		values: {},
		actions: {},
		envVars: {},
		dropped: [],
		preserved: [],
	});

	const settings = {
		async readSettingsFile(path: string): Promise<Result<SettingsFileContents>> {
			const text = files.get(path);
			if (text === undefined) return ok(empty(path));
			const parsed = tomlCodec.parse(text);
			if (!parsed.ok) {
				return err(
					appError("settings_file_invalid", "The settings file is invalid.", parsed.error),
				);
			}
			return ok(parseSettingsDocument(parsed.value, path));
		},
	} as unknown as Pick<SettingsService, "readSettingsFile">;

	const repos = {
		async get(id: RepoId) {
			return ok(repo !== null && id === repo.id ? repo : null);
		},
	} as unknown as RepoRepository;

	const service = new RepoService({
		platform,
		git: {} as GitRunner,
		repos: { repos, settings: {} as RepoServiceDeps["repos"]["settings"] },
		settings,
		removal: { removeWorkspacesOf: async () => ok(undefined) },
	});

	return {
		service,
		files,
		focus: (focused) => focusListener?.(focused),
		config: () => service.store.getState().configs[repoId],
	};
}

const write = (
	files: Map<string, string>,
	path: string,
	document: Record<string, unknown>,
): void => {
	files.set(path, tomlCodec.stringify(document));
};

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

describe("PRJ-04 repo config reads", () => {
	it("reads scripts, prompts, file globs and run mode from .conducted/settings.toml", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			$schema: "https://conducted.app/schemas/settings.repo.schema.json",
			file_include_globs: [".env", "config/*.json"],
			spotlight_testing: true,
			git: { remote_name: "upstream" },
			scripts: {
				setup: "pnpm install",
				archive: "pnpm clean",
				run_mode: "exclusive",
				auto_run_after_setup: true,
				run: {
					dev: { command: "pnpm dev", args: ["--host"], default: true },
					test: { command: "pnpm test" },
				},
			},
			prompts: {
				general: "Be careful.",
				code_review: "Review the change.",
				create_pr: "Write a short description.",
				fix_errors: "Fix the failing check.",
				resolve_merge_conflicts: "Keep both sides.",
				rename_branch: "Use a short name.",
			},
		});

		const config = must(await ctx.service.loadConfig(repoId));

		expect(config.setupScript).toBe("pnpm install");
		expect(config.archiveScript).toBe("pnpm clean");
		expect(config.runMode).toBe("exclusive");
		expect(config.copyFiles).toEqual([".env", "config/*.json"]);
		expect(config.spotlightTesting).toBe(true);
		expect(config.autoRunAfterSetup).toBe(true);
		expect(config.remoteName).toBe("upstream");
		expect(config.prompts).toEqual({
			general: "Be careful.",
			codeReview: "Review the change.",
			createPr: "Write a short description.",
			fixErrors: "Fix the failing check.",
			resolveConflicts: "Keep both sides.",
			renameBranch: "Use a short name.",
		});
		expect(config.runScripts).toHaveLength(2);
		expect(config.runScripts.find((action) => action.id === "dev")).toMatchObject({
			label: "Dev",
			command: "pnpm dev",
			args: ["--host"],
			isDefault: true,
			origin: "shared",
		});
		expect(ctx.config()).toEqual(config);
	});

	it("lets the local file override the shared file and marks actions changed locally", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			file_include_globs: ["shared"],
			scripts: {
				setup: "shared setup",
				run_mode: "concurrent",
				run: { dev: { command: "shared dev", default: true } },
			},
			prompts: { general: "shared prompt" },
		});
		write(ctx.files, localPath, {
			file_include_globs: ["local"],
			scripts: {
				setup: "local setup",
				run_mode: "exclusive",
				run: { dev: { command: "local dev" }, docs: { command: "pnpm docs" } },
			},
			prompts: { general: "local prompt" },
		});

		const config = must(await ctx.service.loadConfig(repoId));

		expect(config.setupScript).toBe("local setup");
		expect(config.runMode).toBe("exclusive");
		expect(config.copyFiles).toEqual(["local"]);
		expect(config.prompts.general).toBe("local prompt");
		const dev = config.runScripts.find((action) => action.id === "dev");
		expect(dev).toMatchObject({ command: "local dev", isDefault: true, origin: "changed_locally" });
		const docs = config.runScripts.find((action) => action.id === "docs");
		expect(docs).toMatchObject({ command: "pnpm docs", origin: "local" });
	});

	it("returns an error and remembers it when a settings file is invalid", async () => {
		const ctx = makeService();
		ctx.files.set(sharedPath, "{ not toml");

		const result = await ctx.service.loadConfig(repoId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("settings_file_invalid");
		expect(ctx.service.store.getState().configErrors?.[repoId]?.code).toBe("settings_file_invalid");
	});

	it("reads the files again when the window regains focus", async () => {
		const ctx = makeService({ withWindow: true });
		write(ctx.files, sharedPath, { scripts: { setup: "before" } });
		must(await ctx.service.loadConfig(repoId));
		expect(ctx.config()?.setupScript).toBe("before");

		write(ctx.files, sharedPath, { scripts: { setup: "after" } });
		ctx.focus(true);

		await vi.waitFor(() => expect(ctx.config()?.setupScript).toBe("after"));
	});

	it("writes the local file and leaves the shared file alone", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			scripts: {
				run: {
					dev: { command: "shared dev", default: true },
					test: { command: "pnpm test" },
				},
			},
		});
		const config = must(await ctx.service.loadConfig(repoId));

		config.setupScript = "pnpm install";
		config.copyFiles = [".env"];
		config.prompts.general = "Be careful.";
		config.runScripts = [
			{
				id: "dev",
				label: "Dev",
				command: "local dev",
				args: [],
				cwd: null,
				isDefault: true,
				hidden: false,
				icon: null,
				origin: "changed_locally",
			},
			{
				id: "docs",
				label: "Docs",
				command: "pnpm docs",
				args: [],
				cwd: null,
				isDefault: false,
				hidden: false,
				icon: null,
				origin: "local",
			},
			{
				id: "test",
				label: "Test",
				command: "pnpm test",
				args: [],
				cwd: null,
				isDefault: false,
				hidden: false,
				icon: null,
				origin: "shared",
			},
		];
		const sharedBefore = ctx.files.get(sharedPath);

		must(await ctx.service.updateConfig(repoId, config));

		expect(ctx.files.get(sharedPath)).toBe(sharedBefore);
		const localText = ctx.files.get(localPath);
		expect(localText).toBeDefined();
		expect(localText).toContain("[scripts.run.dev]");
		expect(localText).toContain('command = "local dev"');
		expect(localText).not.toContain("[scripts.run.test]");

		const reloaded = must(await ctx.service.loadConfig(repoId));
		expect(reloaded.setupScript).toBe("pnpm install");
		expect(reloaded.copyFiles).toEqual([".env"]);
		expect(reloaded.prompts.general).toBe("Be careful.");
		expect(reloaded.runScripts.find((action) => action.id === "dev")).toMatchObject({
			command: "local dev",
			isDefault: true,
			origin: "changed_locally",
		});
		expect(reloaded.runScripts.find((action) => action.id === "docs")).toMatchObject({
			command: "pnpm docs",
			origin: "local",
		});
		expect(reloaded.runScripts.find((action) => action.id === "test")).toMatchObject({
			command: "pnpm test",
			origin: "shared",
		});
	});
});
