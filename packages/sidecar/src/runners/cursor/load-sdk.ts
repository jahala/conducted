/**
 * @feature AGENT-09 Cursor: SDK in process (loading the SDK)
 * Owns: loading `@cursor/sdk` on first use and telling "not installed" apart from "installed but
 * broken".
 * Behaviour: research/conductor/other-runners.md section 2.3: the SDK is loaded lazily in process.
 * Cursor cannot run in Conducted until the SDK is bundled, and D010 keeps it out of the bundle (its
 * licence is the vendor's), so in the shipped app this loader always answers "not installed" and
 * the Agents page shows Cursor as missing.
 * Must handle: the package missing (`cursor_sdk_missing`); any other import failure, such as a
 * syntax error or a missing dependency of the SDK itself (`cursor_sdk_load_failed`, with the
 * reason); a module without the calls the narrow interface needs (`cursor_sdk_missing`, naming
 * them). Every error keeps the import error as its `cause`.
 * Test first: in this repository, where the package is absent, the loader answers
 * `cursor_sdk_missing` and keeps the import error as the cause.
 * Unverified: the export shape. The loader looks for `createAgent` and `resumeAgent` on the module
 * or its default export. The research says Conductor calls them on a platform made by
 * `createAgentPlatform({ localStore, eventNotifier, workspaceRef })`, whose options it does not give
 * in full. Check this against the SDK's type definitions when it is added (cursor-sdk.ts).
 */
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";
import type { CursorSdk, LoadCursorSdk } from "./cursor-sdk.ts";

export const CURSOR_SDK_PACKAGE = "@cursor/sdk";

/** True when the import failed because the package itself is not there. */
function packageMissing(cause: unknown): boolean {
	const code = (cause as { code?: unknown } | null)?.code;
	return code === "ERR_MODULE_NOT_FOUND" && messageOf(cause).includes(`'${CURSOR_SDK_PACKAGE}'`);
}

/**
 * A loader over an import function. The composition root passes a dynamic import, so the SDK is
 * read only when a Cursor chat needs it; a test can pass a module that fails to load.
 */
export function createCursorSdkLoader(
	importModule: (specifier: string) => Promise<unknown>,
): LoadCursorSdk {
	return async (): Promise<Result<CursorSdk, AppError>> => {
		let loaded: unknown;
		try {
			loaded = await importModule(CURSOR_SDK_PACKAGE);
		} catch (cause) {
			if (packageMissing(cause)) {
				return err(appError("cursor_sdk_missing", "Cursor's SDK is not installed.", cause));
			}
			return err(
				appError(
					"cursor_sdk_load_failed",
					`Cursor's SDK could not be loaded: ${messageOf(cause)}`,
					cause,
				),
			);
		}
		const module = loaded as { default?: unknown } | null;
		const candidate = (module?.default ?? module) as Partial<CursorSdk> | null;
		if (
			typeof candidate?.createAgent === "function" &&
			typeof candidate.resumeAgent === "function"
		) {
			return ok(candidate as CursorSdk);
		}
		return err(
			appError(
				"cursor_sdk_missing",
				"Cursor's SDK was found, but it has no createAgent and resumeAgent calls.",
			),
		);
	};
}
