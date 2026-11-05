import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSystem, Platform } from "../../platform/platform.ts";
import type { Setting, SettingsRepository } from "../db/settings.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
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
	validateEnvVarName,
} from "./settings.ts";
import { tomlCodec } from "./toml-codec.ts";

// `delete_branch_on_archive` is file-backed and allowed in repo files; `default_model` is user-file only.
const repoAllowed = getSettingDef("delete_branch_on_archive");
const userOnly = getSettingDef("default_model");
const tableOnly = getSettingDef("default_message_send_mode");

const need = <T>(value: T | undefined): T => {
	if (value === undefined) throw new Error("missing setting in registry");
	return value;
};

interface FakeFs {
	fs: FileSystem;
	files: Map<string, string>;
	failWrites: Set<string>;
	/** Called before a write is accepted; returning an error makes that write fail. */
	writeHook?: (path: string, text: string) => Result<void> | null | Promise<Result<void> | null>;
}

const fakeFs = (home = "/home/user"): FakeFs => {
	const files = new Map<string, string>();
	const failWrites = new Set<string>();
	const fake: FakeFs = {
		fs: undefined as unknown as FileSystem,
		files,
		failWrites,
	};
	const fs: FileSystem = {
		async readText(path) {
			const text = files.get(path);
			return text === undefined ? err(appError("fs_missing", "missing")) : ok(text);
		},
		async writeTextAtomic(path, text) {
			if (failWrites.has(path)) return err(appError("fs_write_failed", "write failed"));
			const hooked = await fake.writeHook?.(path, text);
			if (hooked !== undefined && hooked !== null) return hooked;
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
	fake.fs = fs;
	return fake;
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
	logs: { level: string; message: string; data?: unknown }[];
	git: { calls: GitCommand[]; answer: (command: GitCommand) => Result<string> | null };
}

const harness = (
	options: { home?: string; withWindow?: boolean; withGit?: boolean } = {},
): Harness => {
	const fs = fakeFs(options.home);
	const settings = fakeSettings();
	let unsubscribed = false;
	let focusListener: ((focused: boolean) => void) | null = null;
	const logs: Harness["logs"] = [];
	const git = {
		calls: [] as GitCommand[],
		answer: (_command: GitCommand): Result<string> | null => null,
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
			writeLog(level: string, message: string, data?: unknown) {
				logs.push({ level, message, data });
			},
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
	} as unknown as Platform;
	const gitRunner = {
		async stdout(command: GitCommand) {
			git.calls.push(command);
			const answer = git.answer(command);
			if (answer === null) return err(appError("git_unscripted", "unscripted"));
			return answer;
		},
	} as unknown as Pick<GitRunner, "stdout">;
	const deps: SettingsServiceDeps = {
		platform,
		repos: {
			settings,
			envVars: {} as SettingsServiceDeps["repos"]["envVars"],
		},
		toml: tomlCodec,
		...(options.withGit === true ? { git: gitRunner } : {}),
	};
	return {
		service: new SettingsService(deps),
		fs,
		rows: settings.rows,
		unsubscribed: () => unsubscribed,
		emitFocus: (focused) => focusListener?.(focused),
		logs,
		git,
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

	it("merges actions per id, and a later layer that sets only command keeps the other fields", () => {
		const base: SettingAction = {
			id: "test",
			command: "npm test",
			args: [],
			isDefault: true,
			hidden: true,
			icon: "play",
			availableIn: ["local"],
		};
		const changed: SettingAction = { id: "test", command: "pnpm test" };
		const merged = mergeSettingActions([[base], [changed]]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			id: "test",
			command: "pnpm test",
			isDefault: true,
			hidden: true,
			icon: "play",
			availableIn: ["local"],
		});
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
			[
				"[git]",
				"delete_branch_on_archive = false",
				"",
				"[models]",
				'default = "from-user"',
				"",
			].join("\n"),
		);
		test.fs.files.set(
			"/repo/.conducted/settings.toml",
			[
				"[git]",
				"delete_branch_on_archive = true",
				"",
				"[models]",
				'default = "from-repo"',
				"",
			].join("\n"),
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
		const test = harness({ withGit: true });
		test.fs.files.set(userFile(), "[git]\ndelete_branch_on_archive = false\n");
		test.git.answer = (command) => {
			if (command.args.includes("symbolic-ref")) return ok("refs/remotes/origin/main");
			if (command.args.includes("show")) {
				return ok("[git]\ndelete_branch_on_archive = true\n");
			}
			return null;
		};
		const resolved = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(resolved.ok && resolved.value).toEqual({
			value: true,
			source: "repo-remote",
			isLocked: false,
		});
		expect(test.git.calls.some((call) => call.args.includes("show"))).toBe(true);
	});

	it("reports entries a layer file could not use, alongside the value", async () => {
		const test = harness();
		test.fs.files.set(
			"/repo/.conducted/settings.toml",
			"[git]\ndelete_branch_on_archive = true\nunknown_key = 1\n",
		);
		const resolved = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(resolved.ok && resolved.value).toMatchObject({
			value: true,
			source: "repo-shared",
			dropped: [expect.objectContaining({ key: "git.unknown_key", reason: "unknown-key" })],
		});
	});

	it("reports a layer file that is not valid TOML", async () => {
		const test = harness();
		test.fs.files.set("/repo/.conducted/settings.toml", "{ not toml");
		const resolved = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(resolved.ok && resolved.value.dropped).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ file: "/repo/.conducted/settings.toml", reason: "invalid-file" }),
			]),
		);
	});
});

describe("DATA-05 writing settings", () => {
	it("writes the user file with a schema line and sorted keys", async () => {
		const test = harness();
		expect((await test.service.set("delete_branch_on_archive", true)).ok).toBe(true);
		expect((await test.service.set("default_model", "model-a")).ok).toBe(true);
		const text = test.fs.files.get(userFile());
		expect(text?.startsWith('"$schema" =')).toBe(true);
		const parsed = tomlCodec.parse(text ?? "");
		expect(parsed.ok).toBe(true);
		const document = parsed.ok ? parsed.value : {};
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
		test.fs.files.set(userFile(), "{ not toml");
		const blocked = await test.service.set("delete_branch_on_archive", true);
		expect(blocked.ok).toBe(false);
		expect(!blocked.ok && blocked.error.message).toBe(SETTINGS_FILE_INVALID_MESSAGE);
		const overwritten = await test.service.set("delete_branch_on_archive", true, {
			overwrite: true,
		});
		expect(overwritten.ok).toBe(true);
		expect(test.fs.files.get(userFile())).toContain("delete_branch_on_archive = true");
	});

	it("rolls the store back when the file write fails", async () => {
		const test = harness();
		test.fs.failWrites.add(userFile());
		const result = await test.service.set("delete_branch_on_archive", true);
		expect(result.ok).toBe(false);
		expect(test.service.get("delete_branch_on_archive")).toBe(false);
	});

	it("round-trips a real TOML settings file through the service", async () => {
		const test = harness();
		expect((await test.service.set("delete_branch_on_archive", true)).ok).toBe(true);
		expect((await test.service.set("default_model", "model-a")).ok).toBe(true);
		const reopened = new SettingsService({
			platform: { fs: test.fs.fs } as unknown as SettingsServiceDeps["platform"],
			repos: {
				settings: fakeSettings(),
				envVars: {} as SettingsServiceDeps["repos"]["envVars"],
			},
			toml: tomlCodec,
		});
		expect((await reopened.start()).ok).toBe(true);
		expect(reopened.get("delete_branch_on_archive")).toBe(true);
		expect(reopened.get("default_model")).toBe("model-a");
		reopened.stop();
	});

	it("keeps a later write when an earlier write to the same key fails", async () => {
		const test = harness();
		test.fs.files.set(userFile(), "[git]\ndelete_branch_on_archive = true\n");
		await test.service.start();
		let first = true;
		test.fs.writeHook = (path) => {
			if (path === userFile() && first) {
				first = false;
				return err(appError("fs_write_failed", "first write failed"));
			}
			return null;
		};
		const earlier = test.service.set("delete_branch_on_archive", true);
		const later = test.service.set("delete_branch_on_archive", false);
		const [earlierResult, laterResult] = await Promise.all([earlier, later]);
		expect(earlierResult.ok).toBe(false);
		expect(laterResult.ok).toBe(true);
		expect(test.service.get("delete_branch_on_archive")).toBe(false);
		const parsed = tomlCodec.parse(test.fs.files.get(userFile()) ?? "");
		expect(parsed.ok && parsed.value).toMatchObject({ git: { delete_branch_on_archive: false } });
		test.service.stop();
	});

	it("runs two writes to one file one after the other", async () => {
		const test = harness();
		const writes: string[] = [];
		test.fs.writeHook = (path, text) => {
			if (path === userFile()) writes.push(text);
			return null;
		};
		await Promise.all([
			test.service.set("delete_branch_on_archive", true),
			test.service.set("default_model", "model-a"),
		]);
		expect(writes).toHaveLength(2);
		const second = tomlCodec.parse(writes[1] ?? "");
		expect(second.ok && second.value).toMatchObject({
			git: { delete_branch_on_archive: true },
			models: { default: "model-a" },
		});
	});

	it("keeps an optimistic value when the file is reloaded before the write lands", async () => {
		const test = harness();
		test.fs.files.set(userFile(), '[models]\ndefault = "model-a"\n');
		await test.service.start();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started = false;
		test.fs.writeHook = async (path) => {
			if (path === userFile()) {
				started = true;
				await gate;
			}
			return null;
		};
		const write = test.service.set("default_model", "model-b");
		await vi.waitFor(() => expect(started).toBe(true));
		await test.service.reloadFromDisk();
		expect(test.service.get("default_model")).toBe("model-b");
		release();
		await write;
		expect(test.service.get("default_model")).toBe("model-b");
		test.service.stop();
	});

	it("keeps unknown entries and invalid known values when it rewrites a file", async () => {
		const test = harness();
		test.fs.files.set(
			userFile(),
			[
				"[git]",
				'delete_branch_on_archive = "maybe"',
				"unknown_key = 7",
				"",
				"surprise = true",
				"",
			].join("\n"),
		);
		expect((await test.service.set("default_model", "model-a")).ok).toBe(true);
		const parsed = tomlCodec.parse(test.fs.files.get(userFile()) ?? "");
		expect(parsed.ok && parsed.value).toMatchObject({
			git: { delete_branch_on_archive: "maybe", unknown_key: 7 },
			models: { default: "model-a" },
			surprise: true,
		});
	});

	it("redacts a sensitive setting value in the log", async () => {
		const test = harness();
		expect((await test.service.set("claude_executable_path", "/opt/claude")).ok).toBe(true);
		expect(test.logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ data: { key: "claude_executable_path", value: "[redacted]" } }),
			]),
		);
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
			toml: tomlCodec,
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
			"delete_branch_on_archive = true",
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

	it("lists every setting with its value and source", async () => {
		const test = harness();
		await test.service.set("default_message_send_mode", "queue");
		await test.service.set("default_model", "model-a");
		const listed = test.service.list();
		expect(listed.find((entry) => entry.key === "default_message_send_mode")).toEqual({
			key: "default_message_send_mode",
			value: "queue",
			source: "table",
		});
		expect(listed.find((entry) => entry.key === "default_model")).toEqual({
			key: "default_model",
			value: "model-a",
			source: "user-file",
		});
		expect(listed.find((entry) => entry.key === "theme")).toEqual({
			key: "theme",
			value: "system",
			source: "default",
		});
	});

	it("deletes a table setting and a file setting", async () => {
		const test = harness();
		test.rows.set("default_message_send_mode", "queue");
		await test.service.set("default_model", "model-a");
		expect((await test.service.delete("default_message_send_mode")).ok).toBe(true);
		expect(test.rows.has("default_message_send_mode")).toBe(false);
		expect((await test.service.delete("default_model")).ok).toBe(true);
		expect(test.service.get("default_model")).toBe("");
		const parsed = tomlCodec.parse(test.fs.files.get(userFile()) ?? "");
		expect(parsed.ok && parsed.value).not.toHaveProperty("models.default");
	});

	it("resets a repo value so the shared repository settings win again", async () => {
		const test = harness();
		test.fs.files.set("/repo/.conducted/settings.toml", "[git]\ndelete_branch_on_archive = true\n");
		expect((await test.service.setForRepo("/repo", "delete_branch_on_archive", false)).ok).toBe(
			true,
		);
		const before = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(before.ok && before.value).toMatchObject({ value: false, source: "repo-local" });
		expect((await test.service.resetForRepo("/repo", "delete_branch_on_archive")).ok).toBe(true);
		const after = await test.service.getForRepo("delete_branch_on_archive", "/repo", null);
		expect(after.ok && after.value).toMatchObject({ value: true, source: "repo-shared" });
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
		test.fs.files.set(userFile(), '[models]\ndefault = "model-a"\n');
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
			toml: tomlCodec,
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
		test.fs.files.set(userFile(), '[models]\ndefault = "model-b"\n');
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
		test.fs.files.set(userFile(), '[models]\ndefault = "model-c"\n');
		await vi.advanceTimersByTimeAsync(30_000);
		expect(test.service.get("default_model")).toBe("model-c");
		test.service.stop();
	});

	it("reports dropped entries while reading a file", async () => {
		const test = harness();
		test.fs.files.set(userFile(), '[git]\ndelete_branch_on_archive = "maybe"\n\nsurprise = true\n');
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
