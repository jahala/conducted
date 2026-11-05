import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSystem, Platform, ShellCommand } from "../../platform/platform.ts";
import type { Setting, SettingsRepository } from "../db/settings.ts";
import { getSettingDef } from "../registries/settings.ts";
import {
	actionIdsEqual,
	actionLabel,
	ENV_VAR_KEYCHAIN_MARKER,
	ENV_VAR_NONE_MARKER,
	envVarKeychainKey,
	GIT_EXCLUDE_FAILED_MESSAGE,
	type LayerValue,
	legacyRunAction,
	mergeSettingActions,
	normalizeActionId,
	parseSettingsDocument,
	redactSettingForLog,
	resolveSetting,
	SETTINGS_FILE_INVALID_MESSAGE,
	type SettingAction,
	SettingsService,
	type SettingsServiceDeps,
	SHARED_SETTINGS_READ_ONLY_MESSAGE,
	type TomlCodec,
	validateEnvVarName,
} from "./settings.ts";

// `delete_branch_on_archive` is file-backed and allowed in repo files; `default_model` is user-file only.
const repoAllowed = getSettingDef("delete_branch_on_archive");
const userOnly = getSettingDef("default_model");
const tableOnly = getSettingDef("default_message_send_mode");

const need = <T>(value: T | undefined): T => {
	if (value === undefined) throw new Error("missing setting in registry");
	return value;
};

const jsonToml: TomlCodec = {
	parse(text) {
		try {
			const value: unknown = JSON.parse(text);
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				return err(appError("toml_invalid", "not an object"));
			}
			return ok(value as Record<string, unknown>);
		} catch (cause) {
			return err(appError("toml_invalid", "not JSON", cause));
		}
	},
	stringify: (value) => JSON.stringify(value),
};

interface FakeFs {
	fs: FileSystem;
	files: Map<string, string>;
	failWrites: Set<string>;
}

const fakeFs = (home = "/home/user"): FakeFs => {
	const files = new Map<string, string>();
	const failWrites = new Set<string>();
	const fs: FileSystem = {
		async readText(path) {
			const text = files.get(path);
			return text === undefined ? err(appError("fs_missing", "missing")) : ok(text);
		},
		async writeTextAtomic(path, text) {
			if (failWrites.has(path)) return err(appError("fs_write_failed", "write failed"));
			files.set(path, text);
			return ok(undefined);
		},
		async exists(path) {
			return files.has(path);
		},
		async stat(path) {
			return err(appError("fs_stat", `no stat for ${path}`));
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
		paths: { home, appData: "/app", temp: "/tmp", resources: "/resources" },
	};
	return { fs, files, failWrites };
};

const fakeSettings = (): SettingsRepository & { rows: Map<string, unknown> } => {
	const rows = new Map<string, unknown>();
	const asSetting = (key: string): Setting => ({
		key,
		value: rows.get(key),
		updatedAt: 0,
	});
	return {
		rows,
		async get(key) {
			return ok(rows.has(key) ? asSetting(key) : null);
		},
		async list() {
			return ok([...rows.keys()].sort().map(asSetting));
		},
		async listByPrefix(prefix) {
			return ok([...rows.keys()].filter((key) => key.startsWith(prefix)).map(asSetting));
		},
		async set(key, value) {
			rows.set(key, value);
			return ok(asSetting(key));
		},
		async delete(key) {
			rows.delete(key);
			return ok(undefined);
		},
		async deleteByPrefix(prefix) {
			let count = 0;
			for (const key of [...rows.keys()]) {
				if (key.startsWith(prefix)) {
					rows.delete(key);
					count += 1;
				}
			}
			return ok(count);
		},
	};
};

interface Harness {
	service: SettingsService;
	fs: FakeFs;
	rows: Map<string, unknown>;
	unsubscribed: () => boolean;
	emitFocus: (focused: boolean) => void;
	shell: { calls: ShellCommand[]; answer: (command: ShellCommand) => Result<string> | null };
}

const harness = (
	options: { home?: string; withWindow?: boolean; withShell?: boolean } = {},
): Harness => {
	const fs = fakeFs(options.home);
	const settings = fakeSettings();
	let unsubscribed = false;
	let focusListener: ((focused: boolean) => void) | null = null;
	const shell = {
		calls: [] as ShellCommand[],
		answer: (_command: ShellCommand): Result<string> | null => null,
	};
	const platform = {
		fs: fs.fs,
		keychain: {
			async get() {
				return ok(null);
			},
			async set() {
				return ok(undefined);
			},
			async delete() {
				return ok(undefined);
			},
		},
		app: {
			writeLog() {},
		},
		...(options.withWindow === true
			? {
					window: {
						onFocusChanged(listener: (focused: boolean) => void) {
							focusListener = listener;
							return () => {
								unsubscribed = true;
								focusListener = null;
							};
						},
					},
				}
			: {}),
		...(options.withShell === true
			? {
					shell: {
						async run(command: ShellCommand) {
							shell.calls.push(command);
							const answer = shell.answer(command);
							if (answer === null) return err(appError("shell_unscripted", "unscripted"));
							if (!answer.ok) return answer;
							return ok({ exitCode: 0, stdout: answer.value, stderr: "" });
						},
					},
				}
			: {}),
	} as unknown as Platform;
	const deps: SettingsServiceDeps = {
		platform,
		repos: {
			settings,
			envVars: {} as SettingsServiceDeps["repos"]["envVars"],
		},
		toml: jsonToml,
	};
	return {
		service: new SettingsService(deps),
		fs,
		rows: settings.rows,
		unsubscribed: () => unsubscribed,
		emitFocus: (focused) => focusListener?.(focused),
		shell,
	};
};

const userFile = (home = "/home/user") => `${home}/.conducted/settings.toml`;

afterEach(() => {
	vi.useRealTimers();
});

describe("DATA-05 resolveSetting", () => {
	it("returns the registry default when no layer has a value", () => {
		const def = need(repoAllowed);
		expect(resolveSetting(def, [])).toEqual({
			value: def.default,
			source: "default",
			isLocked: false,
		});
	});

	it("lets a repo shared value beat the user file for a repo-scoped key", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: false },
			{ layer: "repo-shared", value: true },
		];
		expect(resolveSetting(need(repoAllowed), layers)).toEqual({
			value: true,
			source: "repo-shared",
			isLocked: false,
		});
	});

	it("lets the repo local file beat the repo shared file regardless of input order", () => {
		const layers: LayerValue[] = [
			{ layer: "repo-local", value: "a" },
			{ layer: "repo-shared", value: "b" },
		];
		expect(resolveSetting(need(getSettingDef("setup_script")), layers).source).toBe("repo-local");
	});

	it("lets the remote default branch beat the user file and lose to the repo shared file", () => {
		const def = need(repoAllowed);
		expect(
			resolveSetting(def, [
				{ layer: "user-file", value: false },
				{ layer: "repo-remote", value: true },
			]).source,
		).toBe("repo-remote");
		expect(
			resolveSetting(def, [
				{ layer: "repo-remote", value: true },
				{ layer: "repo-shared", value: false },
			]).source,
		).toBe("repo-shared");
	});

	it("ignores repo layers for a user-only key", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: "model-a" },
			{ layer: "repo-shared", value: "model-b" },
		];
		expect(resolveSetting(need(userOnly), layers)).toEqual({
			value: "model-a",
			source: "user-file",
			isLocked: false,
		});
	});

	it("reads non-file-backed keys only from the table", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: "queue" },
			{ layer: "table", value: "steer" },
		];
		expect(resolveSetting(need(tableOnly), layers)).toEqual({
			value: "steer",
			source: "table",
			isLocked: false,
		});
	});
});

describe("DATA-05 action ids and labels", () => {
	it("normalises an id and compares it case-insensitively", () => {
		expect(normalizeActionId("--My Dev-Server!!")).toBe("My-Dev-Server");
		expect(actionIdsEqual("my-dev-server", "My Dev Server")).toBe(true);
	});

	it("gives a label from an id when none is set", () => {
		expect(actionLabel("my-dev-server")).toBe("My dev server");
	});

	it("turns a legacy single run script into the default local run action", () => {
		expect(legacyRunAction("npm run dev")).toEqual({
			id: "run",
			command: "npm run dev",
			args: [],
			cwd: null,
			isDefault: true,
			hidden: false,
			icon: "play",
			availableIn: ["local"],
		});
	});

	it("merges actions per id across layers, and a later layer wins", () => {
		const base: SettingAction = {
			id: "test",
			command: "npm test",
			args: [],
			cwd: null,
			isDefault: true,
			hidden: false,
			icon: null,
			availableIn: ["local"],
		};
		const changed: SettingAction = { ...base, command: "pnpm test" };
		const merged = mergeSettingActions([[base], [changed]]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.id).toBe("test");
		expect(merged[0]?.command).toBe("pnpm test");
	});

	it("reads a legacy run string as the task run and named action tables", () => {
		const legacy = parseSettingsDocument({ scripts: { run: "npm run dev" } }, "file");
		expect(legacy.actions["run"]).toMatchObject({ command: "npm run dev", isDefault: true });
		const named = parseSettingsDocument(
			{ scripts: { run: { test: { command: "npm test", args: ["--watch"], default: true } } } },
			"file",
		);
		expect(named.actions["test"]).toMatchObject({
			command: "npm test",
			args: ["--watch"],
			isDefault: true,
		});
	});
});

describe("DATA-05 reading settings files", () => {
	it("keeps known keys and reports unknown keys and wrong types", () => {
		const parsed = parseSettingsDocument(
			{
				$schema: "https://example.test/settings.json",
				git: { delete_branch_on_archive: true, unknown_key: 1 },
				models: { default_fast_mode: "maybe" },
			},
			"file",
		);
		expect(parsed.values["delete_branch_on_archive"]).toBe(true);
		expect(parsed.dropped).toEqual(
			expect.arrayContaining([
				{ file: "file", key: "git.unknown_key", reason: "unknown-key" },
				{ file: "file", key: "models.default_fast_mode", reason: "wrong-type" },
			]),
		);
	});

	it("parses keychain and none markers without exposing values", () => {
		const parsed = parseSettingsDocument(
			{
				environment_variables: {
					SHARED: "plain",
					[ENV_VAR_KEYCHAIN_MARKER]: ENV_VAR_KEYCHAIN_MARKER,
					local: { LOCAL: "local-value" },
					cloud: { UNSET: ENV_VAR_NONE_MARKER },
				},
			},
			"file",
		);
		expect(parsed.envVars["all:SHARED"]).toMatchObject({ marker: "value", value: "plain" });
		expect(parsed.envVars["local:LOCAL"]).toMatchObject({
			marker: "value",
			value: "local-value",
		});
		expect(parsed.envVars["cloud:UNSET"]).toMatchObject({ marker: "none", value: null });
	});

	it("marks a keychain entry as such and keeps only its name", () => {
		const parsed = parseSettingsDocument(
			{ environment_variables: { API_KEY: ENV_VAR_KEYCHAIN_MARKER } },
			"file",
		);
		expect(parsed.envVars["all:API_KEY"]).toMatchObject({
			name: "API_KEY",
			marker: "keychain",
			value: null,
		});
	});
});

describe("DATA-05 layers from files and the remote default branch", () => {
	it("reads a repo shared file over the user file and reads a user-only key from the user file", async () => {
		const test = harness();
		test.fs.files.set(
			userFile(),
			JSON.stringify({
				git: { delete_branch_on_archive: false },
				models: { default: "from-user" },
			}),
		);
		test.fs.files.set(
			"/repo/.conducted/settings.toml",
			JSON.stringify({
				git: { delete_branch_on_archive: true },
				models: { default: "from-repo" },
			}),
		);
		const repo = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(repo.ok && repo.value).toEqual({
			value: true,
			source: "repo-shared",
			isLocked: false,
		});
		const user = await test.service.getForRepo("default_model", "/repo", null);
		expect(user.ok && user.value).toEqual({
			value: "from-user",
			source: "user-file",
			isLocked: false,
		});
	});

	it("reads the shared file from origin's default branch when the checkout is stale", async () => {
		const test = harness({ withShell: true });
		test.fs.files.set(userFile(), JSON.stringify({ git: { delete_branch_on_archive: false } }));
		test.shell.answer = (command) => {
			if (command.args.includes("symbolic-ref")) return ok("refs/remotes/origin/main\n");
			if (command.args.includes("show")) {
				return ok(JSON.stringify({ git: { delete_branch_on_archive: true } }));
			}
			return null;
		};
		const resolved = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(resolved.ok && resolved.value).toEqual({
			value: true,
			source: "repo-remote",
			isLocked: false,
		});
		expect(test.shell.calls.some((call) => call.args.includes("show"))).toBe(true);
	});
});

describe("DATA-05 writing settings", () => {
	it("writes the user file with a schema line and sorted keys", async () => {
		const test = harness();
		expect((await test.service.set("delete_branch_on_archive", true)).ok).toBe(true);
		expect((await test.service.set("default_model", "model-a")).ok).toBe(true);
		const text = test.fs.files.get(userFile());
		expect(text).toBeDefined();
		const document = JSON.parse(text ?? "{}") as Record<string, unknown>;
		expect(document["$schema"]).toBe("https://conducted.app/schemas/settings.schema.json");
		expect(Object.keys(document)).toEqual([...Object.keys(document)].sort());
		expect(document).toMatchObject({
			git: { delete_branch_on_archive: true },
			models: { default: "model-a" },
		});
	});

	it("writes non-file-backed keys to the settings table", async () => {
		const test = harness();
		expect((await test.service.set("default_message_send_mode", "queue")).ok).toBe(true);
		expect(test.rows.get("default_message_send_mode")).toBe("queue");
		expect(test.service.get("default_message_send_mode")).toBe("queue");
	});

	it("refuses an unknown key", async () => {
		const test = harness();
		const result = await test.service.set("not_a_setting", true);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("setting_unknown");
	});

	it("refuses to save into an invalid file, and overwrites only when asked", async () => {
		const test = harness();
		test.fs.files.set(userFile(), "{ not json");
		const blocked = await test.service.set("delete_branch_on_archive", true);
		expect(blocked.ok).toBe(false);
		expect(!blocked.ok && blocked.error.message).toBe(SETTINGS_FILE_INVALID_MESSAGE);
		const overwritten = await test.service.set("delete_branch_on_archive", true, {
			overwrite: true,
		});
		expect(overwritten.ok).toBe(true);
		expect(test.fs.files.get(userFile())).toContain('"delete_branch_on_archive":true');
	});

	it("rolls the store back when the file write fails", async () => {
		const test = harness();
		test.fs.failWrites.add(userFile());
		const result = await test.service.set("delete_branch_on_archive", true);
		expect(result.ok).toBe(false);
		expect(test.service.get("delete_branch_on_archive")).toBe(false);
	});

	it("rolls the store back when the table write fails", async () => {
		const test = harness();
		const rows = fakeSettings();
		const service = new SettingsService({
			platform: {
				fs: test.fs.fs,
			} as unknown as SettingsServiceDeps["platform"],
			repos: {
				settings: {
					...rows,
					async set(): Promise<Result<Setting>> {
						return err(appError("db_failed", "write failed"));
					},
				},
				envVars: {} as SettingsServiceDeps["repos"]["envVars"],
			},
			toml: jsonToml,
		});
		const result = await service.set("default_message_send_mode", "queue");
		expect(result.ok).toBe(false);
		expect(service.get("default_message_send_mode")).toBe("steer");
	});

	it("writes a repo value to the local file and excludes the local file from git", async () => {
		const test = harness();
		const result = await test.service.setForRepo("/repo", "delete_branch_on_archive", true);
		expect(result.ok).toBe(true);
		expect(test.fs.files.get("/repo/.conducted/settings.local.toml")).toContain(
			'"delete_branch_on_archive":true',
		);
		expect(test.fs.files.get("/repo/.git/info/exclude")).toBe(
			"/.conducted/*\n!.conducted/settings.toml\n",
		);
	});

	it("refuses to write the shared repo file", async () => {
		const test = harness();
		const result = await test.service.setForRepo("/repo", "delete_branch_on_archive", true, {
			target: "shared",
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.message).toBe(SHARED_SETTINGS_READ_ONLY_MESSAGE);
	});

	it("keeps the local file and warns when the git exclude write fails", async () => {
		const test = harness();
		test.fs.failWrites.add("/repo/.git/info/exclude");
		const result = await test.service.setForRepo("/repo", "delete_branch_on_archive", true);
		expect(result.ok).toBe(true);
		expect(test.fs.files.get("/repo/.conducted/settings.local.toml")).toBeDefined();
		expect(test.service.store.getState().warnings).toEqual(
			expect.arrayContaining([{ code: "git_exclude_failed", message: GIT_EXCLUDE_FAILED_MESSAGE }]),
		);
	});
});

describe("DATA-05 loading at startup and reloading", () => {
	it("loads the table and the user file", async () => {
		const test = harness();
		test.rows.set("default_message_send_mode", "queue");
		test.fs.files.set(userFile(), JSON.stringify({ models: { default: "model-a" } }));
		expect((await test.service.start()).ok).toBe(true);
		expect(test.service.store.getState().loaded).toBe(true);
		expect(test.service.get("default_message_send_mode")).toBe("queue");
		expect(test.service.get("default_model")).toBe("model-a");
		test.service.stop();
	});

	it("keeps the defaults and warns when the table cannot be read", async () => {
		const test = harness();
		const failing = new SettingsService({
			platform: {
				fs: test.fs.fs,
			} as unknown as SettingsServiceDeps["platform"],
			repos: {
				settings: {
					...fakeSettings(),
					async list() {
						return err(appError("db_failed", "read failed"));
					},
				},
				envVars: {} as SettingsServiceDeps["repos"]["envVars"],
			},
			toml: jsonToml,
		});
		expect((await failing.start()).ok).toBe(true);
		expect(failing.get("default_message_send_mode")).toBe("steer");
		expect(failing.store.getState().warnings).toEqual(
			expect.arrayContaining([
				{ code: "settings_load_failed", message: "Failed to load settings" },
			]),
		);
		failing.stop();
	});

	it("reloads the user file when the window gains focus", async () => {
		const test = harness({ withWindow: true });
		await test.service.start();
		expect(test.service.get("default_model")).toBe("");
		test.fs.files.set(userFile(), JSON.stringify({ models: { default: "model-b" } }));
		test.emitFocus(true);
		await vi.waitFor(() => {
			expect(test.service.get("default_model")).toBe("model-b");
		});
		test.service.stop();
		expect(test.unsubscribed()).toBe(true);
	});

	it("re-reads the config files every 30 seconds", async () => {
		vi.useFakeTimers();
		const test = harness();
		await test.service.start();
		test.fs.files.set(userFile(), JSON.stringify({ models: { default: "model-c" } }));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(test.service.get("default_model")).toBe("model-c");
		test.service.stop();
	});

	it("reports dropped entries while reading a file", async () => {
		const test = harness();
		test.fs.files.set(
			userFile(),
			JSON.stringify({ git: { delete_branch_on_archive: "maybe" }, surprise: true }),
		);
		await test.service.start();
		expect(test.service.store.getState().dropped).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "git.delete_branch_on_archive", reason: "wrong-type" }),
				expect.objectContaining({ key: "surprise", reason: "unknown-key" }),
			]),
		);
		test.service.stop();
	});
});

describe("DATA-05 env vars and redaction", () => {
	it("accepts identifiers and rejects others", () => {
		expect(validateEnvVarName("API_KEY_2").ok).toBe(true);
		expect(validateEnvVarName("2BAD").ok).toBe(false);
		expect(validateEnvVarName("has-dash").ok).toBe(false);
	});
	it("builds distinct keychain keys per scope", () => {
		expect(envVarKeychainKey("global", "A")).toBe("env:global:A");
		expect(envVarKeychainKey({ repoId: "r1" as RepoId }, "A")).toBe("env:repo:r1:A");
	});
	it("redacts sensitive setting values for logs", () => {
		expect(redactSettingForLog("claude_executable_path", "/opt/claude")).toBe("[redacted]");
		expect(redactSettingForLog("theme", "dark")).toBe("dark");
	});
});
