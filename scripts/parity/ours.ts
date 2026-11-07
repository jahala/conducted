/**
 * Our backend's name lists, read from the code that defines them, for the parity harness's backend
 * check: the protocol's method tables, the sidecar's app tools, the Tauri adapter's command map, the
 * Rust event names, the Tauri plugins the shell registers, the settings registry and the migrations.
 * Behaviour: docs/plans/parity-harness.md section 3, check e.
 * Must handle: a list that cannot be read (a moved file, a renamed table) is a thrown error naming
 * where it looked, never an empty list, so a broken read cannot pass as "nothing matches".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTING_KEYS } from "../../apps/desktop/src/core/registries/settings.ts";
import {
	appToSidecarNotifications,
	appToSidecarRequests,
	sidecarToAppNotifications,
	sidecarToAppRequests,
} from "../../packages/protocol/src/rpc.ts";
import { ADAPTER, commandEntries, TAURI_SRC } from "../guards/structure.ts";
import type { BackendInventory } from "./lib.ts";
import { schemaTables } from "./spec.ts";

/** Plugins that are part of Tauri's core, so every Tauri 2 app has them. */
const CORE_PLUGINS = [
	"app",
	"event",
	"window",
	"webview",
	"path",
	"menu",
	"image",
	"resources",
	"tray",
];

function nonEmpty(what: string, names: string[]): string[] {
	if (names.length === 0) throw new Error(`Read no ${what}; the place it is read from has moved.`);
	return [...new Set(names)].sort();
}

function files(dir: string, pattern: RegExp): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...files(path, pattern));
		else if (pattern.test(entry.name)) found.push(path);
	}
	return found;
}

export function rpcMethods(): string[] {
	return nonEmpty("protocol methods", [
		...Object.keys(appToSidecarRequests),
		...Object.keys(appToSidecarNotifications),
		...Object.keys(sidecarToAppNotifications),
		...Object.keys(sidecarToAppRequests),
	]);
}

/** The tool names our sidecar's app tools declare (`name: "GetWorkspaceDiff"`). */
export function toolNames(root: string): string[] {
	const names: string[] = [];
	for (const path of files(join(root, "packages/sidecar/src/tools"), /^[^.]+\.ts$/)) {
		for (const match of readFileSync(path, "utf8").matchAll(/\bname: "([A-Z][A-Za-z]+)"/g)) {
			names.push(match[1] ?? "");
		}
	}
	return nonEmpty("sidecar tool names", names);
}

export function tauriCommands(root: string): string[] {
	const entries = commandEntries(readFileSync(join(root, ADAPTER), "utf8"));
	if (entries === null) throw new Error(`${ADAPTER} has no COMMANDS map.`);
	return nonEmpty(
		"Tauri commands",
		entries.map((entry) => entry.name),
	);
}

/** Event names the Rust shell emits, from its `EVENT_*: &str` constants. */
export function tauriEvents(root: string): string[] {
	const names: string[] = [];
	for (const path of files(join(root, TAURI_SRC), /\.rs$/)) {
		for (const match of readFileSync(path, "utf8").matchAll(/const EVENT_\w+: &str = "([^"]+)"/g)) {
			names.push(match[1] ?? "");
		}
	}
	return nonEmpty("Tauri events", names);
}

/** Plugin names the shell has: Tauri's core ones and each `tauri-plugin-<name>` dependency. */
export function tauriPlugins(root: string): string[] {
	const cargo = readFileSync(join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
	const deps = [...cargo.matchAll(/^tauri-plugin-([a-z-]+)\s*=/gm)].map((match) => match[1] ?? "");
	return nonEmpty("Tauri plugins", [...CORE_PLUGINS, ...deps]);
}

export function settingsKeys(): string[] {
	return nonEmpty("settings keys", [...SETTING_KEYS]);
}

export function tables(root: string): string[] {
	const dir = join(root, "apps/desktop/src-tauri/migrations");
	const names = files(dir, /\.sql$/).flatMap((path) => schemaTables(readFileSync(path, "utf8")));
	// tauri-plugin-sql keeps its applied-version ledger in this table (apps/desktop/src-tauri/src/db.rs);
	// no migration creates it, so the SQL files alone never name it.
	return nonEmpty("tables", [...names, "_sqlx_migrations"]);
}

/** Our names per backend inventory. Plugin commands are named `<plugin>|*`: a plugin brings all of its commands. */
export function ourNames(root: string): Record<BackendInventory, string[]> {
	const methods = rpcMethods();
	return {
		sidecar_rpc_method: methods,
		sidecar_call: methods,
		sidecar_tool_name: toolNames(root),
		tauri_command: tauriCommands(root),
		tauri_plugin_command: tauriPlugins(root).map((plugin) => `${plugin}|*`),
		tauri_event: tauriEvents(root),
		settings_key: settingsKeys(),
		table: tables(root),
	};
}
