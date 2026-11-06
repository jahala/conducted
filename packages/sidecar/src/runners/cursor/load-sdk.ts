/**
 * @feature AGENT-09 Cursor: SDK in process (loading the SDK)
 * Owns: finding Cursor's SDK where the program manager installs it, loading it on first use, and
 * adapting the loaded module to the narrow interface (cursor-sdk.ts).
 * Behaviour: research/conductor/other-runners.md section 2.3 (the SDK is loaded lazily in
 * process). The owner ruled that the SDK installs on demand through the program manager and is
 * never bundled (D010, D078): binaries.rs unpacks it into
 * `<agent binaries>/cursor/<version>/node_modules/` and points `cursor/current` at the version.
 * The loader reads `cursor/current/node_modules/@cursor/sdk/package.json`, imports the file its
 * `bun` export names, and takes `createAgentPlatform` and `AuthenticationError` from it. Nothing
 * is read or imported at startup: `locate()` reads one package.json for the Agents list, and
 * `load()` imports at the first Cursor chat.
 * Must handle: the SDK not installed (`cursor_sdk_missing`, pointing to the Advanced page, where
 * the program manager installs it); a package.json that cannot be read or has no `bun` entry, an
 * import that fails (a syntax error, a missing dependency), a module without the two calls, and an
 * install without the native package of this CPU (all `cursor_sdk_load_failed`, keeping the cause);
 * a second load (the same SDK, no second import); one platform per store folder, so two chats of
 * one workspace share the SDK's SQLite store.
 * Our design choice: the native package (ripgrep, the shell parser) is named to the SDK through
 * CURSOR_RIPGREP_PATH and CURSOR_TREE_SITTER_VENDOR_DIR. The SDK looks for it beside the running
 * program, which is the app bundle, not app data. Its sandbox helper has no such variable, so a
 * user whose ~/.cursor/sandbox.json asks for sandboxing gets the SDK's own "not supported" error.
 * Test first: with no SDK in the agent binaries folder, the loader answers `cursor_sdk_missing`
 * and points to the Advanced page.
 */
import path from "node:path";
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";
import { isRecord } from "../../util/records.ts";
import type {
	CursorPlatform,
	CursorSdk,
	CursorSdkLoader,
	CursorSdkLocation,
} from "./cursor-sdk.ts";

/** The managed program name of the SDK, and its folder under the agent binaries folder. */
export const CURSOR_SDK_PROGRAM = "cursor";
/** The link binaries.rs points at the ready version (`CURSOR_CURRENT_LINK` there). */
export const CURSOR_CURRENT_LINK = "current";
export const CURSOR_SDK_PACKAGE = "@cursor/sdk";
/** The entry @cursor/sdk 1.3.1 names under `exports["."].bun`. */
export const CURSOR_SDK_ENTRY = "./dist/bundled/index.js";

const MISSING_MESSAGE =
	"Cursor's SDK is not installed. Install it on the Advanced page of Settings.";

export interface CursorSdkLoaderDeps {
	/** The program manager's folder (`CONDUCTED_AGENT_BINARIES_DIR`). */
	agentBinariesDir: string;
	/** This Mac's CPU as Node names it: `arm64` or `x64`. */
	cpu: string;
	/** Reads a text file; `null` when it does not exist. */
	readText(target: string): Promise<Result<string | null, AppError>>;
	/** Imports a module by absolute path. The composition root passes a dynamic import. */
	importModule(entry: string): Promise<unknown>;
}

interface Located extends CursorSdkLocation {
	entry: string;
}

function loadFailed(message: string, cause?: unknown): AppError {
	return appError("cursor_sdk_load_failed", `Cursor's SDK could not be loaded: ${message}`, cause);
}

/** The `bun` entry of a package.json's `exports["."]`. */
function bunEntry(manifest: Record<string, unknown>): string | undefined {
	const exports = manifest.exports;
	if (!isRecord(exports)) return undefined;
	const root = exports["."];
	if (!isRecord(root)) return undefined;
	return typeof root.bun === "string" ? root.bun : undefined;
}

function adapt(
	module: Record<string, unknown>,
	version: string,
	env: Readonly<Record<string, string>>,
): CursorSdk | null {
	const create = module.createAgentPlatform;
	const authError = module.AuthenticationError;
	if (typeof create !== "function" || typeof authError !== "function") return null;
	const platforms = new Map<string, Promise<CursorPlatform>>();
	return {
		version,
		env,
		isAuthenticationError: (error) => error instanceof authError,
		createPlatform: (options) => {
			const open = platforms.get(options.stateRoot);
			if (open !== undefined) return open;
			const opening = (create as (o: typeof options) => Promise<CursorPlatform>)(options);
			platforms.set(options.stateRoot, opening);
			// A platform that failed to open is not kept, so the next chat tries again.
			void opening.catch(() => {
				if (platforms.get(options.stateRoot) === opening) platforms.delete(options.stateRoot);
			});
			return opening;
		},
	};
}

export function createCursorSdkLoader(deps: CursorSdkLoaderDeps): CursorSdkLoader {
	const tree = path.join(deps.agentBinariesDir, CURSOR_SDK_PROGRAM, CURSOR_CURRENT_LINK);
	const modules = path.join(tree, "node_modules");
	const sdkFolder = path.join(modules, CURSOR_SDK_PACKAGE);
	const nativeName = `${CURSOR_SDK_PACKAGE}-darwin-${deps.cpu}`;
	const nativeFolder = path.join(modules, nativeName);
	let loaded: Promise<Result<CursorSdk, AppError>> | null = null;

	const locate = async (): Promise<Result<Located | null, AppError>> => {
		const read = await deps.readText(path.join(sdkFolder, "package.json"));
		if (!read.ok) return err(loadFailed(read.error.message, read.error));
		if (read.value === null) return ok(null);
		let manifest: unknown;
		try {
			manifest = JSON.parse(read.value);
		} catch (cause) {
			return err(loadFailed(`its package.json is not valid JSON: ${messageOf(cause)}`, cause));
		}
		if (!isRecord(manifest) || typeof manifest.version !== "string") {
			return err(loadFailed("its package.json has no version."));
		}
		const entry = bunEntry(manifest);
		if (entry === undefined) return err(loadFailed("its package.json names no bun entry."));
		return ok({
			folder: tree,
			version: manifest.version,
			entry: path.join(sdkFolder, entry),
		});
	};

	const loadOnce = async (): Promise<Result<CursorSdk, AppError>> => {
		const located = await locate();
		if (!located.ok) return located;
		if (located.value === null) return err(appError("cursor_sdk_missing", MISSING_MESSAGE));
		const native = await deps.readText(path.join(nativeFolder, "package.json"));
		if (!native.ok) return err(loadFailed(native.error.message, native.error));
		if (native.value === null) {
			return err(
				loadFailed(
					`its native package ${nativeName} is missing. Download it again on the Advanced page of Settings.`,
				),
			);
		}
		let module: unknown;
		try {
			module = await deps.importModule(located.value.entry);
		} catch (cause) {
			return err(loadFailed(messageOf(cause), cause));
		}
		const sdk = isRecord(module)
			? adapt(module, located.value.version, {
					CURSOR_RIPGREP_PATH: path.join(nativeFolder, "bin", "rg"),
					CURSOR_TREE_SITTER_VENDOR_DIR: path.join(nativeFolder, "vendor"),
				})
			: null;
		if (sdk === null) {
			return err(loadFailed("the module has no createAgentPlatform and AuthenticationError."));
		}
		return ok(sdk);
	};

	return {
		locate: async () => {
			const located = await locate();
			if (!located.ok || located.value === null) return located;
			return ok({ folder: located.value.folder, version: located.value.version });
		},
		load: () => {
			if (loaded !== null) return loaded;
			const loading = loadOnce();
			loaded = loading;
			// Only a loaded SDK is kept: after a failure (not installed yet) the next chat looks again.
			void loading.then((result) => {
				if (!result.ok && loaded === loading) loaded = null;
			});
			return loading;
		},
	};
}
