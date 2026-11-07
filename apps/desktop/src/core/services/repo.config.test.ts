import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Dialogs, FileSystem, Opener, Shell, ShellOutput } from "../../platform/platform.ts";
import { createTestIds } from "../../test/ids.ts";
import { tomlText } from "../../test/toml-text.ts";
import { localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import type { RepoRepository } from "../db/repos.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo } from "../model.ts";
import { RepoService, type RepoServiceDeps, repoConfigFrom } from "./repo.ts";
import {
	parseSettingsDocument,
	type SettingsFileContents,
	SettingsService,
	type SettingsServiceDeps,
} from "./settings.ts";
import { tomlCodec } from "./toml-codec.ts";

const repoId = "repo-1" as RepoId;
const rootPath = "/code/app";
const sharedPath = sharedSettingsFile(rootPath);
const localPath = localSettingsFile(rootPath);

interface HeldRead {
	started: Promise<void>;
	release: () => void;
}

interface Harness {
	service: RepoService;
	files: Map<string, string>;
	focus: (focused: boolean) => void;
	config: () => ReturnType<RepoService["store"]["getState"]>["configs"][string] | undefined;
	holdNextRead: (path: string) => HeldRead;
	listenerActive: () => boolean;
}

function makeService(
	options: {
		withWindow?: boolean;
		repo?: Repo | null;
		git?: GitRunner;
		cloudWorkspace?: boolean;
	} = {},
): Harness {
	const files = new Map<string, string>();
	let focusListener: ((focused: boolean) => void) | null = null;
	let heldPath: string | null = null;
	let heldStarts: (() => void) | null = null;
	let heldRelease: (() => void) | null = null;
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
		async registerRoot() {
			return ok(undefined);
		},
		paths: { home: "/home/me", appData: "/app", temp: "/tmp", resources: "/resources" },
	} as unknown as FileSystem;

	const platform = {
		fs,
		dialogs: {} as Dialogs,
		opener: {} as Opener,
		shell: {} as Shell,
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

	const read = (path: string): Result<SettingsFileContents> => {
		const text = files.get(path);
		if (text === undefined) return ok(empty(path));
		const parsed = tomlCodec.parse(text);
		if (!parsed.ok) {
			return err(appError("settings_file_invalid", "The settings file is invalid.", parsed.error));
		}
		return ok(parseSettingsDocument(parsed.value, path));
	};

	// Writes go through the real settings service, over the same files.
	const writer = new SettingsService({
		platform: { fs, app: { writeLog() {} } } as unknown as SettingsServiceDeps["platform"],
		repos: {
			settings: {} as SettingsServiceDeps["repos"]["settings"],
			envVars: {} as SettingsServiceDeps["repos"]["envVars"],
		},
		toml: tomlCodec,
	});

	const settings = {
		updateSettingsFile: writer.updateSettingsFile.bind(writer),
		readSettingsText: writer.readSettingsText.bind(writer),
		async removeEnvVarsForRepo(): Promise<Result<void>> {
			return ok(undefined);
		},
		async readSettingsFile(path: string): Promise<Result<SettingsFileContents>> {
			// Read the text now, so a held read answers with the contents it saw when it started.
			const result = read(path);
			if (heldPath === path) {
				const start = heldStarts;
				const wait = new Promise<void>((resolve) => {
					heldRelease = resolve;
				});
				heldPath = null;
				heldStarts = null;
				start?.();
				await wait;
			}
			return result;
		},
	} as unknown as RepoServiceDeps["settings"];

	const repos = {
		async get(id: RepoId) {
			return ok(repo !== null && id === repo.id ? repo : null);
		},
		async delete() {
			return ok(undefined);
		},
	} as unknown as RepoRepository;
	const workspaces = {
		async listByRepo() {
			if (options.cloudWorkspace !== true || repo === null) return ok([]);
			return ok([
				{
					id: "workspace-1",
					repoId: repo.id,
					host: { kind: "cloud", url: "https://worker.example", vmId: "sandbox-1" },
				},
			]);
		},
	} as unknown as RepoServiceDeps["repos"]["workspaces"];

	const service = new RepoService({
		platform,
		git: options.git ?? ({} as GitRunner),
		repos: {
			repos,
			settings: {} as RepoServiceDeps["repos"]["settings"],
			workspaces,
		},
		settings,
		removal: { removeWorkspacesOf: async () => ok(undefined), releaseBacklogOf: () => {} },
		ids: createTestIds(),
	});

	return {
		service,
		files,
		focus: (focused) => focusListener?.(focused),
		config: () => service.store.getState().configs[repoId],
		holdNextRead: (path) => {
			let start!: () => void;
			const started = new Promise<void>((resolve) => {
				start = resolve;
			});
			heldPath = path;
			heldStarts = start;
			return {
				started,
				release: () => heldRelease?.(),
			};
		},
		listenerActive: () => focusListener !== null,
	};
}

const write = (
	files: Map<string, string>,
	path: string,
	document: Record<string, unknown>,
): void => {
	files.set(path, tomlText(document));
};

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

/** A git that answers the shared-clone commands and records every command line. */
function gitAnswers(
	answers: { fetch?: Result<ShellOutput>; lsTree?: string; show?: string } = {},
): { git: GitRunner; calls: string[][] } {
	const calls: string[][] = [];
	const run = async (command: { args: readonly string[] }) => {
		calls.push([...command.args]);
		if (command.args[0] === "fetch" && answers.fetch !== undefined) return answers.fetch;
		if (command.args[0] === "ls-tree") {
			return ok({ exitCode: 0, stdout: answers.lsTree ?? "", stderr: "" });
		}
		if (command.args[0] === "show") {
			return ok({ exitCode: 0, stdout: answers.show ?? "", stderr: "" });
		}
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	};
	const git = {
		run,
		async stdout(command: { args: readonly string[] }) {
			const result = await run(command);
			return result.ok ? ok(result.value.stdout.trim()) : result;
		},
	} as unknown as GitRunner;
	return { git, calls };
}

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
		ctx.service.dispose();
	});

	it("retries a repository whose last read failed when the window regains focus", async () => {
		const ctx = makeService({ withWindow: true });
		ctx.files.set(sharedPath, "{ not toml");
		const failed = await ctx.service.loadConfig(repoId);
		expect(failed.ok).toBe(false);
		expect(ctx.service.store.getState().configErrors?.[repoId]?.code).toBe("settings_file_invalid");

		write(ctx.files, sharedPath, { scripts: { setup: "fixed" } });
		ctx.focus(true);

		await vi.waitFor(() => expect(ctx.config()?.setupScript).toBe("fixed"));
		expect(ctx.service.store.getState().configErrors?.[repoId]).toBeUndefined();
		ctx.service.dispose();
	});

	it("keeps the written config when a load that began before the write finishes late", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, { scripts: { setup: "old" } });
		const before = must(await ctx.service.loadConfig(repoId));

		const held = ctx.holdNextRead(localPath);
		const slowLoad = ctx.service.loadConfig(repoId);
		await held.started;

		must(await ctx.service.updateConfig(repoId, { ...before, setupScript: "new" }));
		held.release();
		must(await slowLoad);

		expect(ctx.config()?.setupScript).toBe("new");
	});

	it("does not bring a removed project back when its config read ends late", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, { scripts: { setup: "old" } });

		const held = ctx.holdNextRead(localPath);
		const slowLoad = ctx.service.loadConfig(repoId);
		await held.started;

		must(await ctx.service.remove(repoId));
		held.release();
		await slowLoad;

		expect(ctx.config()).toBeUndefined();
	});

	it("does not write a value that still matches the shared file", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			spotlight_testing: true,
			scripts: { run_mode: "exclusive", auto_run_after_setup: true },
		});
		const config = must(await ctx.service.loadConfig(repoId));
		config.setupScript = "pnpm install";

		must(await ctx.service.updateConfig(repoId, config));

		const localText = ctx.files.get(localPath) ?? "";
		expect(localText).not.toContain("run_mode");
		expect(localText).not.toContain("spotlight_testing");
		expect(localText).not.toContain("auto_run_after_setup");

		write(ctx.files, sharedPath, {
			spotlight_testing: false,
			scripts: { run_mode: "concurrent", auto_run_after_setup: false },
		});
		const reloaded = must(await ctx.service.loadConfig(repoId));
		expect(reloaded.runMode).toBe("concurrent");
		expect(reloaded.spotlightTesting).toBe(false);
		expect(reloaded.autoRunAfterSetup).toBe(false);
	});

	it("writes an explicit empty value when the user clears a shared value", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			file_include_globs: [".env"],
			preview_urls: ["http://localhost:3000"],
			scripts: { setup: "shared setup" },
			prompts: { general: "shared prompt" },
		});
		const config = must(await ctx.service.loadConfig(repoId));
		expect(config.previewUrls).toEqual([{ name: "", url: "http://localhost:3000" }]);
		config.copyFiles = [];
		config.previewUrls = [];
		config.setupScript = null;
		config.prompts.general = null;

		must(await ctx.service.updateConfig(repoId, config));

		const localText = ctx.files.get(localPath) ?? "";
		expect(localText).toContain("file_include_globs = []");
		expect(localText).toContain('preview_urls = ""');

		const reloaded = must(await ctx.service.loadConfig(repoId));
		expect(reloaded.copyFiles).toEqual([]);
		expect(reloaded.previewUrls).toEqual([]);
		expect(reloaded.setupScript).toBeNull();
		expect(reloaded.prompts.general).toBeNull();
	});

	it("keeps every preview URL's name and order and writes Conductor's string", async () => {
		const ctx = makeService();
		write(ctx.files, sharedPath, {
			preview_urls: [
				{ name: "Local", url: "http://localhost:3000" },
				"https://example.test/preview",
			],
		});

		const config = must(await ctx.service.loadConfig(repoId));
		expect(config.previewUrls).toEqual([
			{ name: "Local", url: "http://localhost:3000" },
			{ name: "", url: "https://example.test/preview" },
		]);

		config.previewUrls = [
			{ name: "Preview", url: "https://example.test/preview" },
			{ name: "Local", url: "http://localhost:3000" },
			{ name: "", url: "http://localhost:3001" },
		];
		must(await ctx.service.updateConfig(repoId, config));

		const localText = ctx.files.get(localPath) ?? "";
		const stored = must(tomlCodec.parse(localText));
		expect(stored.preview_urls).toBe(JSON.stringify(config.previewUrls));

		const reloaded = must(await ctx.service.loadConfig(repoId));
		expect(reloaded.previewUrls).toEqual(config.previewUrls);
	});

	it("reads a plain string and a list of strings as preview URLs with no name", async () => {
		const plain = makeService();
		write(plain.files, sharedPath, { preview_urls: "https://old.example" });
		const plainConfig = must(await plain.service.loadConfig(repoId));
		expect(plainConfig.previewUrls).toEqual([{ name: "", url: "https://old.example" }]);

		const listed = makeService();
		write(listed.files, sharedPath, {
			preview_urls: ["https://one.example", "https://two.example"],
		});
		const listedConfig = must(await listed.service.loadConfig(repoId));
		expect(listedConfig.previewUrls).toEqual([
			{ name: "", url: "https://one.example" },
			{ name: "", url: "https://two.example" },
		]);
	});

	it("keeps a comment beside preview_urls when the entry changes", async () => {
		const ctx = makeService();
		ctx.files.set(localPath, '# keep me\npreview_urls = ["https://old.example"]\n# after\n');
		const config = must(await ctx.service.loadConfig(repoId));

		config.previewUrls = [{ name: "New", url: "https://new.example" }];
		must(await ctx.service.updateConfig(repoId, config));

		const localText = ctx.files.get(localPath) ?? "";
		expect(localText).toContain("# keep me");
		expect(localText).toContain("# after");
	});

	it("reports a wrongly typed value and falls back to the registry default", () => {
		const shared: SettingsFileContents = {
			file: sharedPath,
			values: {
				run_script_mode: "sideways" as never,
				spotlight_testing: "yes" as never,
			},
			actions: {},
			envVars: {},
			dropped: [],
			preserved: [],
		};
		const local: SettingsFileContents = {
			file: localPath,
			values: {},
			actions: {},
			envVars: {},
			dropped: [],
			preserved: [],
		};

		const read = repoConfigFrom(shared, local);

		expect(read.config.runMode).toBe("concurrent");
		expect(read.config.spotlightTesting).toBe(false);
		expect(read.dropped).toEqual([
			{ file: sharedPath, key: "scripts.run_mode", reason: "unsupported-value" },
			{ file: sharedPath, key: "spotlight_testing", reason: "wrong-type" },
		]);
	});

	it("removes the focus listener when disposed", async () => {
		const ctx = makeService({ withWindow: true });
		must(await ctx.service.loadConfig(repoId));
		expect(ctx.listenerActive()).toBe(true);

		ctx.service.dispose();

		expect(ctx.listenerActive()).toBe(false);
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
				availableIn: ["local", "cloud"],
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
				availableIn: ["local", "cloud"],
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
				availableIn: ["local", "cloud"],
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

	it("writes and reads where an action can run", async () => {
		const ctx = makeService();
		const config = must(await ctx.service.loadConfig(repoId));
		config.runScripts = [
			{
				id: "deploy",
				label: "Deploy",
				command: "pnpm deploy",
				args: [],
				cwd: null,
				isDefault: true,
				hidden: false,
				icon: null,
				origin: "local",
				availableIn: ["cloud"],
			},
		];

		must(await ctx.service.updateConfig(repoId, config));

		expect(ctx.files.get(localPath)).toContain('available_in = [ "cloud" ]');
		const reloaded = must(await ctx.service.loadConfig(repoId));
		expect(reloaded.runScripts.find((action) => action.id === "deploy")?.availableIn).toEqual([
			"cloud",
		]);
	});
});

describe("CLOUD-04 a cloud repo's shared clone", () => {
	it("reads the shared settings from the clone's branch, not the working tree", async () => {
		const { git, calls } = gitAnswers({
			lsTree: ".conducted/settings.toml\n",
			show: tomlText({
				scripts: { setup: "npm ci" },
				prompts: { general: "shared prompt" },
			}),
		});
		const ctx = makeService({ git, cloudWorkspace: true });
		write(ctx.files, sharedPath, { scripts: { setup: "working tree setup" } });

		const config = must(await ctx.service.loadConfig(repoId));

		expect(config.setupScript).toBe("npm ci");
		expect(config.prompts.general).toBe("shared prompt");
		expect(calls).toEqual([
			["remote", "set-head", "origin", "--auto"],
			[
				"fetch",
				"--no-write-fetch-head",
				"--",
				"origin",
				"refs/heads/main:refs/remotes/origin/main",
			],
			["ls-tree", "origin/main", "--", ".conducted/settings.toml"],
			["show", "--no-ext-diff", "--no-textconv", "origin/main:.conducted/settings.toml"],
		]);
	});

	it("a cloud repo with no settings file at the ref has no shared settings", async () => {
		const { git, calls } = gitAnswers({ lsTree: "" });
		const ctx = makeService({ git, cloudWorkspace: true });
		write(ctx.files, sharedPath, { scripts: { setup: "working tree setup" } });

		const config = must(await ctx.service.loadConfig(repoId));

		expect(config.setupScript).toBeNull();
		expect(calls.some((args) => args[0] === "show")).toBe(false);
	});

	it("a failed fetch is the config's error, never a quiet fallback", async () => {
		const { git } = gitAnswers({
			fetch: err(appError("git_failed", "Failed to fetch origin/main in the shared cloud clone.")),
		});
		const ctx = makeService({ git, cloudWorkspace: true });

		const result = await ctx.service.loadConfig(repoId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("Failed to fetch");
	});

	it("a local repo still reads the working-tree file and runs no shared-clone git", async () => {
		const { git, calls } = gitAnswers();
		const ctx = makeService({ git });
		write(ctx.files, sharedPath, { scripts: { setup: "local checkout setup" } });

		const config = must(await ctx.service.loadConfig(repoId));

		expect(config.setupScript).toBe("local checkout setup");
		expect(calls).toEqual([]);
	});
});
