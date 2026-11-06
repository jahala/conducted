/**
 * @feature AGENT-09 Cursor: SDK in process (loading the SDK)
 * Owns: tests for the Cursor SDK loader: the package missing, an SDK that fails to load, and a
 * module without the calls the runner needs.
 * Test first: in this repository, where the package is absent, the loader answers
 * `cursor_sdk_missing` and keeps the import error as the cause.
 */
import { describe, expect, test } from "bun:test";
import { FakeCursorSdk } from "../../test-support/cursor-fakes.ts";
import { createCursorSdkLoader } from "./load-sdk.ts";

/** An import error shaped like the one Bun throws for a module it cannot resolve. */
function notFound(specifier: string): Error {
	return Object.assign(new Error(`Cannot find module '${specifier}' from '/app/sidecar'`), {
		code: "ERR_MODULE_NOT_FOUND",
	});
}

describe("AGENT-09 Cursor SDK loader", () => {
	test("AGENT-09 the real import in this repository answers not installed, with the cause", async () => {
		const loaded = await createCursorSdkLoader((specifier) => import(specifier))();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_missing");
		expect(loaded.error.message).toBe("Cursor's SDK is not installed.");
		expect((loaded.error.cause as { code?: unknown } | undefined)?.code).toBe(
			"ERR_MODULE_NOT_FOUND",
		);
	});

	test("AGENT-09 an SDK that fails to load is not reported as missing", async () => {
		const broken = new SyntaxError("Unexpected token in the SDK");
		const loaded = await createCursorSdkLoader(async () => {
			throw broken;
		})();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.message).toContain("Unexpected token in the SDK");
		expect(loaded.error.cause).toBe(broken);
	});

	test("AGENT-09 a missing dependency of the SDK itself is a load failure, not a missing SDK", async () => {
		const cause = notFound("zod/v4");
		const loaded = await createCursorSdkLoader(async () => {
			throw cause;
		})();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_load_failed");
		expect(loaded.error.cause).toBe(cause);
	});

	test("AGENT-09 a module without createAgent and resumeAgent is refused by name", async () => {
		const loaded = await createCursorSdkLoader(async () => ({ default: { createAgent() {} } }))();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cursor_sdk_missing");
		expect(loaded.error.message).toContain("createAgent and resumeAgent");
	});

	test("AGENT-09 a module with both calls is the SDK", async () => {
		const sdk = new FakeCursorSdk();
		const loaded = await createCursorSdkLoader(async () => ({ default: sdk }))();
		expect(loaded.ok && loaded.value).toBe(sdk);
	});
});
