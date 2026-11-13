/**
 * The Tauri config override of the live reference run (stage 2, live.ts), and the checks that keep it
 * where it belongs.
 *
 * - The run builds the end-to-end test app (e2e/harness.ts `buildTestApp`) with this override merged
 *   in last, into its own target folder (D145). The override's `frontendDist` is the reference
 *   server's bridge page, so the app's window opens that page instead of our UI: the page our real
 *   `__TAURI_INTERNALS__` answers through (bridge.ts). Tauri treats a `frontendDist` URL as the app's
 *   own page, and our navigation guard keeps the window on the origin Tauri loads the UI from
 *   (src-tauri/src/navigation.rs, `app_origin`). No release build carries the override, and our own
 *   config files never name the bridge (`checkAppConfig`, tested over the real files).
 * - The server listens on our dev server's origin, `http://localhost:1420`, which must be free.
 * - The bridge page may reach only the server it came from and the app's IPC (`BRIDGE_POLICY`); the
 *   server sends the same policy with the page, since Tauri adds no policy to a page it does not serve.
 * - `checkOverride` refuses an override that points anywhere but our dev origin, lets the page reach
 *   another host, or changes anything beyond the page, its policy and hiding the app's windows.
 */

/** The bridge page's path on the reference server. */
export const BRIDGE_PATH = "/__reference/bridge";

/** Only the server itself and the app's IPC; no other host, no frames, no plugins. */
export const BRIDGE_POLICY = [
	"default-src 'self'",
	"connect-src 'self' ipc: http://ipc.localhost",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"frame-src 'none'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'none'",
].join("; ");

/** The one origin a dev build of our app keeps in its window (navigation.rs `DEV_ORIGIN`). */
export const DEV_ORIGIN = "http://localhost:1420";

export interface ReferenceOverride {
	build: { frontendDist: string };
	app: { security: { csp: string; devCsp: string }; windows: Record<string, unknown>[] };
}

/**
 * The override for our app's config. Its windows are the app's own (`windows`, from
 * tauri.conf.json), hidden: the bridge page needs no screen, and the run should not take the owner's
 * screen for each launch. A JSON merge patch replaces a list whole, so the list is copied.
 */
export function referenceOverride(windows: readonly Record<string, unknown>[]): ReferenceOverride {
	return {
		build: { frontendDist: `${DEV_ORIGIN}${BRIDGE_PATH}` },
		app: {
			security: { csp: BRIDGE_POLICY, devCsp: BRIDGE_POLICY },
			windows: windows.map((window) => ({ ...window, visible: false })),
		},
	};
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
	build: ["frontendDist"],
	app: ["security", "windows"],
	"app.security": ["csp", "devCsp"],
};

/**
 * What is wrong with an override; empty when it is safe to build with. `windows` are the app's own
 * windows: the override may only hide them.
 */
export function checkOverride(
	override: ReferenceOverride,
	windows: readonly Record<string, unknown>[],
): string[] {
	const problems: string[] = [];
	const hidden = JSON.stringify(windows.map((window) => ({ ...window, visible: false })));
	if (JSON.stringify(override.app.windows) !== hidden) {
		problems.push("the override changes the app's windows beyond hiding them");
	}
	const record = override as unknown as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!(key in ALLOWED_KEYS)) problems.push(`the override sets ${key}`);
	}
	for (const [path, keys] of Object.entries(ALLOWED_KEYS)) {
		const value = path
			.split(".")
			.reduce<unknown>(
				(node, part) =>
					node !== null && typeof node === "object"
						? (node as Record<string, unknown>)[part]
						: undefined,
				record,
			);
		if (value === null || typeof value !== "object") continue;
		for (const key of Object.keys(value)) {
			if (!keys.includes(key)) problems.push(`the override sets ${path}.${key}`);
		}
	}
	const origin = new URL(override.build.frontendDist).origin;
	if (origin !== DEV_ORIGIN) {
		problems.push(
			`frontendDist ${override.build.frontendDist} is not on our dev origin ${DEV_ORIGIN}`,
		);
	}
	for (const name of ["csp", "devCsp"] as const) {
		const hosts = override.app.security[name].match(/[a-z][a-z0-9+.-]*:\/\/[^\s;']+/gi) ?? [];
		for (const host of hosts) {
			if (host !== "http://ipc.localhost" && host !== DEV_ORIGIN) {
				problems.push(`${name} names a host other than the reference server: ${host}`);
			}
		}
	}
	return problems;
}

/** What in one of our own Tauri config files names the reference run; empty when nothing does. */
export function checkAppConfig(text: string): string[] {
	return text.includes(BRIDGE_PATH) ? [`names the reference bridge (${BRIDGE_PATH})`] : [];
}
