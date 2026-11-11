/**
 * The dependency rules in docs/architecture.md are enforced by Biome. This test proves each rule
 * still fires: it writes one forbidden import into the folder the rule covers, runs Biome on it,
 * and expects a noRestrictedImports error. A control import that is allowed must pass.
 * Probe files are named __guard_probe_<pid>_*.ts; probes left by a killed run are removed first.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { walk } from "./lib.ts";

const root = join(import.meta.dir, "../..");
const biome = join(root, "node_modules/.bin/biome");
const PROBE = /__guard_probe_\d+_\w+\.ts$/;
const written: string[] = [];

interface Probe {
	name: string;
	folder: string;
	source: string;
	rule: string;
	allowed?: true;
}

const probes: Probe[] = [
	{
		name: "shared",
		folder: "packages/shared/src",
		source: 'import "@conducted/protocol";',
		rule: "noRestrictedImports",
	},
	{
		name: "protocol",
		folder: "packages/protocol/src",
		source: 'import "@conducted/sidecar";',
		rule: "noRestrictedImports",
	},
	{
		name: "sidecar",
		folder: "packages/sidecar/src",
		source: 'import "@conducted/desktop";',
		rule: "noRestrictedImports",
	},
	{
		name: "platform",
		folder: "apps/desktop/src/platform",
		source: 'import "../core/hooks.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "core_tauri",
		folder: "apps/desktop/src/core",
		source: 'import "@tauri-apps/api/core";',
		rule: "noRestrictedImports",
	},
	{
		name: "core_screens",
		folder: "apps/desktop/src/core",
		source: 'import "../features/sidebar/x.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_db",
		folder: "apps/desktop/src/features",
		source: 'import "../core/db/workspaces.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_services",
		folder: "apps/desktop/src/features",
		source: 'import "../core/services/workspace.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_container",
		folder: "apps/desktop/src/features",
		source: 'import "../core/container.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_cloud",
		folder: "apps/desktop/src/features",
		source: 'import "../core/cloud/settings.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_git",
		folder: "apps/desktop/src/features",
		source: 'import "../core/git/status.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_conductor_import",
		folder: "apps/desktop/src/features",
		source: 'import "../core/conductor-import/plan.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "ui_services",
		folder: "apps/desktop/src/ui",
		source: 'import "../core/services/settings.ts";',
		rule: "noRestrictedImports",
	},
	{
		name: "features_allowed",
		folder: "apps/desktop/src/features",
		source: 'import "../core/registries/settings.ts";',
		rule: "noRestrictedImports",
		allowed: true,
	},
	{
		name: "ui_tauri",
		folder: "apps/desktop/src/ui",
		source: 'import "@tauri-apps/api/core";',
		rule: "noRestrictedImports",
	},
	{
		name: "app_tauri",
		folder: "apps/desktop/src/app",
		source: 'import "@tauri-apps/api/core";',
		rule: "noRestrictedImports",
	},
	{
		name: "floating",
		folder: "apps/desktop/src/core",
		source: "async function w(): Promise<void> {}\nexport function g(): void {\n\tw();\n}",
		rule: "noFloatingPromises",
	},
	{
		name: "control",
		folder: "apps/desktop/src/platform",
		source: 'import "@tauri-apps/api/core";',
		rule: "noRestrictedImports",
		allowed: true,
	},
];

beforeAll(() => {
	for (const stale of walk(root, root, PROBE)) rmSync(stale, { force: true });
});
afterAll(() => {
	for (const path of written) rmSync(path, { force: true });
});

for (const probe of probes) {
	test(`${probe.allowed ? "allows" : "rejects"}: ${probe.name}`, () => {
		const path = join(root, probe.folder, `__guard_probe_${process.pid}_${probe.name}.ts`);
		writeFileSync(path, `/** Guard probe. */\n${probe.source}\n`);
		written.push(path);
		const run = Bun.spawnSync([biome, "lint", "--max-diagnostics=50", path], { cwd: root });
		const output = `${run.stdout.toString()}${run.stderr.toString()}`;
		if (probe.allowed) expect(output).not.toContain(probe.rule);
		else expect(output).toContain(probe.rule);
	});
}

test("no probe files remain in the probed folders", () => {
	for (const probe of probes) {
		const left = readdirSync(join(root, probe.folder)).filter(
			(name) => PROBE.test(name) && !name.includes(`_${process.pid}_`),
		);
		expect(left).toEqual([]);
	}
});
