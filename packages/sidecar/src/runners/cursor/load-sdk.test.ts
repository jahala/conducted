/**
 * @feature AGENT-09 Cursor: SDK in process (loading the SDK)
 * Owns: tests for the Cursor SDK loader: the SDK not installed, an SDK that fails to load, a
 * missing native package, a module without the calls the runner needs, finding the installed
 * version without loading it, and loading once.
 * Test first: with no SDK in the agent binaries folder, the loader answers `cursor_sdk_missing`
 * and points to the Advanced page.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appError, err } from "@conducted/shared";
import {
	cursorSdkFiles,
	FakeCursorAuthenticationError,
	FakeCursorSdk,
} from "../../test-support/cursor-fakes.ts";
import { readTextIfPresent } from "../../util/read-text.ts";
import { CURSOR_SDK_ENTRY, createCursorSdkLoader } from "./load-sdk.ts";

const ROOT = "/app-data/agent-binaries";
const SDK_FOLDER = path.join(ROOT, "cursor", "current", "node_modules", "@cursor", "sdk");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** An import error shaped like the one Bun throws for a module it cannot resolve. */
function notFound(specifier: string): Error {
	return Object.assign(new Error(`Cannot find module '${specifier}' from '/app/sidecar'`), {
		code: "ERR_MODULE_NOT_FOUND",
	});
}

function loader(importModule: (entry: string) => Promise<unknown>, files = cursorSdkFiles(ROOT)) {
	return createCursorSdkLoader({
		agentBinariesDir: ROOT,
		cpu: "arm64",
		readText: files.readText,
		importModule,
	});
}

describe("AGENT-09 Cursor SDK loader", () => {
	test("AGENT-09 with no SDK installed the loader answers not installed and points to Settings", async () => {
		const empty = await mkdtemp(path.join(tmpdir(), "cursor-binaries-"));
		cleanups.push(() => rm(empty, { recursive: true, force: true }));
		let imported = 0;
		const subject = createCursorSdkLoader({
			agentBinariesDir: empty,
			cpu: "arm64",
			readText: readTextIfPresent,
			importModule: async () => {
				imported += 1;
				return {};
			},
		});

		expect(await subject.locate()).toEqual({ ok: true, value: null });
		const loaded = await subject.load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_missing");
		expect(loaded.error.message).toBe(
			"Cursor's SDK is not installed. Install it on the Advanced page of Settings.",
		);
		expect(imported).toBe(0);
	});

	test("AGENT-09 an SDK that fails to load is not reported as missing", async () => {
		const broken = new SyntaxError("Unexpected token in the SDK");
		const loaded = await loader(async () => {
			throw broken;
		}).load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.message).toContain("Unexpected token in the SDK");
		expect(loaded.error.cause).toBe(broken);
	});

	test("AGENT-09 a missing dependency of the SDK itself is a load failure, not a missing SDK", async () => {
		const cause = notFound("zod/v4");
		const loaded = await loader(async () => {
			throw cause;
		}).load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.cause).toBe(cause);
	});

	test("AGENT-09 a module without createAgentPlatform and AuthenticationError is refused by name", async () => {
		const loaded = await loader(async () => ({ createAgentPlatform() {} })).load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.message).toContain("createAgentPlatform and AuthenticationError");
	});

	test("AGENT-09 a module with both is the SDK, loaded from the bun entry of its package.json", async () => {
		const sdk = new FakeCursorSdk();
		const entries: string[] = [];
		const subject = loader(async (entry) => {
			entries.push(entry);
			return sdk.module();
		});

		const loaded = await subject.load();
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(entries).toEqual([path.join(SDK_FOLDER, CURSOR_SDK_ENTRY)]);
		expect(loaded.value.version).toBe("1.3.1");
		expect(loaded.value.isAuthenticationError(new FakeCursorAuthenticationError("no"))).toBe(true);
		expect(loaded.value.isAuthenticationError(new Error("Invalid User API Key"))).toBe(false);
		const native = path.join(
			ROOT,
			"cursor",
			"current",
			"node_modules",
			"@cursor",
			"sdk-darwin-arm64",
		);
		expect(loaded.value.env).toEqual({
			CURSOR_RIPGREP_PATH: path.join(native, "bin", "rg"),
			CURSOR_TREE_SITTER_VENDOR_DIR: path.join(native, "vendor"),
		});

		// One platform per store folder, shared by every chat of the workspace.
		const first = await loaded.value.createPlatform({ stateRoot: "/s/a", workspaceRef: "/w/a" });
		const again = await loaded.value.createPlatform({ stateRoot: "/s/a", workspaceRef: "/w/a" });
		const other = await loaded.value.createPlatform({ stateRoot: "/s/b", workspaceRef: "/w/b" });
		expect(again).toBe(first);
		expect(other).toBeDefined();
		expect(sdk.platformCalls).toEqual([
			{ stateRoot: "/s/a", workspaceRef: "/w/a" },
			{ stateRoot: "/s/b", workspaceRef: "/w/b" },
		]);

		// A second load is the same SDK and imports nothing again.
		const second = await subject.load();
		expect(second.ok && second.value).toBe(loaded.value);
		expect(entries).toHaveLength(1);
	});

	test("AGENT-09 locate reads the installed version without loading the SDK", async () => {
		let imported = 0;
		const located = await loader(async () => {
			imported += 1;
			return {};
		}).locate();
		expect(located).toEqual({
			ok: true,
			value: { folder: path.join(ROOT, "cursor", "current"), version: "1.3.1" },
		});
		expect(imported).toBe(0);
	});

	test("AGENT-09 an install without the native package of this CPU is a load failure", async () => {
		const sdk = new FakeCursorSdk();
		const loaded = await createCursorSdkLoader({
			agentBinariesDir: ROOT,
			cpu: "x64",
			readText: cursorSdkFiles(ROOT, "arm64").readText,
			importModule: async () => sdk.module(),
		}).load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.message).toContain("@cursor/sdk-darwin-x64");
	});

	test("AGENT-09 a package.json that cannot be read is an error, not a missing SDK", async () => {
		const failure = appError("read_failed", "Permission denied");
		const located = await loader(async () => ({}), {
			readText: async () => err(failure),
		}).locate();
		expect(located.ok).toBe(false);
		if (located.ok) return;
		expect(located.error.code).toBe("cursor_sdk_load_failed");
		expect(located.error.cause).toBe(failure);
	});
});
