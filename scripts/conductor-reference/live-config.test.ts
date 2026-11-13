import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BRIDGE_PATH,
	BRIDGE_POLICY,
	checkAppConfig,
	checkOverride,
	referenceOverride,
} from "./live-config.ts";

const ORIGIN = "http://localhost:1420";
const SRC_TAURI = join(import.meta.dir, "../../apps/desktop/src-tauri");
const WINDOWS = (
	JSON.parse(readFileSync(join(SRC_TAURI, "tauri.conf.json"), "utf8")) as {
		app: { windows: Record<string, unknown>[] };
	}
).app.windows;

describe("referenceOverride", () => {
	test("points the test app's UI at the bridge page and keeps the page's connections on that server", () => {
		const override = referenceOverride(WINDOWS);
		// A `frontendDist` URL is the page a built app opens as its own; the guard keeps the window on
		// its origin (navigation.rs, `plat_22_the_app_origin_is_where_tauri_loads_the_ui_from`).
		expect(override.build).toEqual({ frontendDist: `${ORIGIN}${BRIDGE_PATH}` });
		// A built app reads `csp`, a dev build `devCsp`: both are the bridge's one policy.
		expect(override.app.security.devCsp).toBe(override.app.security.csp);
		expect(override.app.security.csp).toContain("connect-src 'self' ipc: http://ipc.localhost");
		expect(checkOverride(override, WINDOWS)).toEqual([]);
	});

	test("the policy lets the page reach only its own server and the app's IPC", () => {
		expect(BRIDGE_POLICY).toContain("default-src 'self'");
		expect(BRIDGE_POLICY).toContain("connect-src 'self' ipc: http://ipc.localhost");
		expect(BRIDGE_POLICY).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
	});
});

describe("checkOverride", () => {
	test("refuses a page on any other origin", () => {
		const override = referenceOverride(WINDOWS);
		override.build.frontendDist = "http://192.168.1.4:8080/__reference/bridge";
		expect(checkOverride(override, WINDOWS)).toEqual([
			"frontendDist http://192.168.1.4:8080/__reference/bridge is not on our dev origin http://localhost:1420",
		]);
	});

	test("refuses a policy that lets the page reach another host", () => {
		const override = referenceOverride(WINDOWS);
		override.app.security.devCsp = `${BRIDGE_POLICY}; connect-src https://api.example.com`;
		expect(checkOverride(override, WINDOWS)).toEqual([
			"devCsp names a host other than the reference server: https://api.example.com",
		]);
	});

	test("hides the app's own windows and changes nothing else about them", () => {
		const override = referenceOverride(WINDOWS);
		expect(override.app.windows.map((window) => [window.label, window.visible])).toEqual([
			["main", false],
		]);
		const resized = referenceOverride(WINDOWS);
		resized.app.windows = resized.app.windows.map((window) => ({ ...window, width: 800 }));
		expect(checkOverride(resized, WINDOWS)).toEqual([
			"the override changes the app's windows beyond hiding them",
		]);
	});

	test("refuses an override that changes anything beyond the page and its policy", () => {
		const override = referenceOverride(WINDOWS) as ReturnType<typeof referenceOverride> & {
			identifier?: string;
		};
		override.identifier = "build.conducted.other";
		expect(checkOverride(override, WINDOWS)).toEqual(["the override sets identifier"]);
	});
});

describe("checkAppConfig", () => {
	test("our app's own configs never name the reference server or its bridge", () => {
		for (const file of ["tauri.conf.json", "tauri.release.conf.json"]) {
			expect(checkAppConfig(readFileSync(join(SRC_TAURI, file), "utf8"))).toEqual([]);
		}
	});

	test("finds a config that names the bridge", () => {
		expect(
			checkAppConfig(JSON.stringify({ build: { frontendDist: `${ORIGIN}${BRIDGE_PATH}` } })),
		).toEqual([`names the reference bridge (${BRIDGE_PATH})`]);
	});
});
