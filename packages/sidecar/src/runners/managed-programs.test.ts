/**
 * @feature PLAT-28 Agent program manager: the sidecar finds the managed copies
 * Tests the finder over real folders laid out the way the Rust program manager writes them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ok } from "@conducted/shared";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import {
	createManagedProgramFinder,
	nodeManagedProgramFiles,
	shellEnvWithBinDirFirst,
} from "./managed-programs.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** An app data folder with `bin/` and `agent-binaries/`, as the program manager lays them out. */
async function appData() {
	const root = await mkdtemp(path.join(tmpdir(), "conducted-plat-28-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	const binDir = path.join(root, "bin");
	const agentBinariesDir = path.join(root, "agent-binaries");
	await mkdir(binDir, { recursive: true });
	await mkdir(agentBinariesDir, { recursive: true });
	const find = createManagedProgramFinder({
		binDir,
		agentBinariesDir,
		files: nodeManagedProgramFiles,
	});
	/** Writes `<agent-binaries>/<name>/<version>/<file>` and links `bin/<name>` to it. */
	const install = async (name: string, version: string, file = name, mode = 0o755) => {
		const folder = path.join(agentBinariesDir, name, version);
		await mkdir(folder, { recursive: true });
		const binary = path.join(folder, file);
		await writeFile(binary, "#!/bin/sh\nexit 0\n");
		await chmod(binary, mode);
		await symlink(binary, path.join(binDir, name));
		return binary;
	};
	return { root, binDir, agentBinariesDir, find, install };
}

describe("PLAT-28 the sidecar finds the managed copies", () => {
	test("PLAT-28 a bin link into the agent binaries folder is the managed copy, with its version", async () => {
		const data = await appData();
		const binary = await nodeManagedProgramFiles.realPath(await data.install("claude", "2.1.308"));

		expect(await data.find("claude")).toEqual({ path: binary ?? "", version: "2.1.308" });
	});

	test("PLAT-28 no link means no managed copy", async () => {
		const data = await appData();

		expect(await data.find("codex")).toBeNull();
	});

	test("PLAT-28 a link that points outside the agent binaries folder is not a managed copy", async () => {
		const data = await appData();
		const elsewhere = path.join(data.root, "my-claude");
		await writeFile(elsewhere, "#!/bin/sh\n");
		await chmod(elsewhere, 0o755);
		await symlink(elsewhere, path.join(data.binDir, "claude"));

		expect(await data.find("claude")).toBeNull();
	});

	test("PLAT-28 a plain file in the bin folder is not a managed copy", async () => {
		const data = await appData();
		await writeFile(path.join(data.binDir, "gh"), "#!/bin/sh\n");
		await chmod(path.join(data.binDir, "gh"), 0o755);

		expect(await data.find("gh")).toBeNull();
	});

	test("PLAT-28 a link whose program is gone is not a managed copy", async () => {
		const data = await appData();
		await symlink(
			path.join(data.agentBinariesDir, "claude", "2.1.308", "claude"),
			path.join(data.binDir, "claude"),
		);

		expect(await data.find("claude")).toBeNull();
	});

	test("PLAT-28 a program that cannot run is not a managed copy", async () => {
		const data = await appData();
		await data.install("codex", "0.164.0", "codex", 0o644);

		expect(await data.find("codex")).toBeNull();
	});

	test("PLAT-28 a link to another program's file is not a managed copy", async () => {
		const data = await appData();
		await data.install("claude", "2.1.308", "codex");

		expect(await data.find("claude")).toBeNull();
	});

	test("PLAT-28 a name with a slash is not looked up", async () => {
		const data = await appData();
		await data.install("claude", "2.1.308");

		expect(await data.find("../bin/claude")).toBeNull();
	});
});

describe("PLAT-35 the app's bin folder comes first on the agents' PATH", () => {
	const captured: CapturedShellEnv = {
		shell: "/bin/zsh",
		path: "/usr/local/bin:/usr/bin",
		env: { PATH: "/usr/local/bin:/usr/bin", HOME: "/Users/me" },
		providerSecrets: {},
	};
	const provider = (value: CapturedShellEnv): ShellEnvProvider => ({
		get: async () => ok(value),
		refresh: async () => ok(value),
	});

	test("PLAT-35 every capture starts its PATH with the bin folder", async () => {
		const wrapped = shellEnvWithBinDirFirst(provider(captured), "/data/bin");

		const got = await wrapped.get("/work");
		const again = await wrapped.refresh("/work");

		expect(got).toEqual(
			ok({
				...captured,
				path: "/data/bin:/usr/local/bin:/usr/bin",
				env: { PATH: "/data/bin:/usr/local/bin:/usr/bin", HOME: "/Users/me" },
			}),
		);
		expect(again).toEqual(got);
	});

	test("PLAT-35 a capture without a PATH gets the bin folder alone", async () => {
		const wrapped = shellEnvWithBinDirFirst(
			provider({ ...captured, path: "", env: { HOME: "/Users/me" } }),
			"/data/bin",
		);

		const got = await wrapped.get();

		expect(got.ok && got.value.env.PATH).toBe("/data/bin");
		expect(got.ok && got.value.path).toBe("/data/bin");
	});
});
