/**
 * The Tauri config override of the live reference run (stage 2, live.ts), and the checks that keep it
 * where it belongs.
 *
 * - The run builds our app's debug binary with this override merged in (Tauri reads it from the
 *   `TAURI_CONFIG` variable at build time), into a target folder under /tmp. Its window then opens the
 *   reference server's bridge page instead of our UI: the page our real `__TAURI_INTERNALS__` answers
 *   through (bridge.ts). No release build sets the variable, and our own config files never name the
 *   bridge (`checkAppConfig`, tested over the real files).
 * - The server takes our dev server's origin, `http://localhost:1420`: our navigation guard keeps a
 *   dev build's window on that origin only and opens any other in the user's browser
 *   (src-tauri/src/navigation.rs, `DEV_ORIGIN`; the test reads it from there).
 * - The bridge page may reach only the server it came from and the app's IPC (`BRIDGE_POLICY`); the
 *   server sends the same policy with the page, since Tauri adds no policy to a page from `devUrl`.
 * - `checkOverride` refuses an override that points anywhere but our dev origin, lets the page reach
 *   another host, or changes anything beyond the dev page, its policy and hiding the app's windows.
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
	build: { devUrl: string; beforeDevCommand: string };
	app: { security: { csp: string; devCsp: string }; windows: Record<string, unknown>[] };
}

/**
 * The override for our app's config. Its windows are the app's own (`windows`, from
 * tauri.conf.json), hidden: the bridge page needs no screen, and the run should not take the owner's
 * screen for each launch. A JSON merge patch replaces a list whole, so the list is copied.
 */
export function referenceOverride(windows: readonly Record<string, unknown>[]): ReferenceOverride {
	return {
		build: { devUrl: `${DEV_ORIGIN}${BRIDGE_PATH}`, beforeDevCommand: "" },
		app: {
			security: { csp: BRIDGE_POLICY, devCsp: BRIDGE_POLICY },
			windows: windows.map((window) => ({ ...window, visible: false })),
		},
	};
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
	build: ["devUrl", "beforeDevCommand"],
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
	const origin = new URL(override.build.devUrl).origin;
	if (origin !== DEV_ORIGIN) {
		problems.push(`devUrl ${override.build.devUrl} is not on our dev origin ${DEV_ORIGIN}`);
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
