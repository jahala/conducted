/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * @feature AGENT-09 Cursor: SDK in process
 * Tests the image's facts against the Dockerfile: a pinned base, the pinned program versions the
 * app pins, the managed-program paths the sidecar reads, Cursor's SDK tree where its loader finds
 * it, and no secret in the image.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	entryCompileArguments,
	IMAGE_SCRIPTS,
	imageInputPaths,
} from "../../apps/cloud/sandbox/build.ts";
import {
	cursorSdkCurrentLink,
	cursorSdkFolder,
	IMAGE,
	programPath,
} from "../../apps/cloud/sandbox/image.ts";
import { CLOUD_BUILD_DEFAULT_OUT } from "../../packages/sidecar/src/cloud-build.ts";
import {
	createCursorSdkLoader,
	cursorNativePackageName,
} from "../../packages/sidecar/src/runners/cursor/load-sdk.ts";
import { readTextIfPresent } from "../../packages/sidecar/src/util/read-text.ts";

const root = join(import.meta.dir, "../..");
const dockerfile = readFileSync(join(root, "apps/cloud/sandbox/Dockerfile"), "utf8");
const rustSource = readFileSync(join(root, "apps/desktop/src-tauri/src/binaries.rs"), "utf8");
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
	version: string;
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function pinnedRustVersion(program: string): string | undefined {
	const body = /pub fn pinned_version[\s\S]*?\n\}/.exec(rustSource)?.[0] ?? "";
	const name = program.charAt(0).toUpperCase() + program.slice(1);
	return new RegExp(`ManagedProgram::${name} => "([^"]+)"`).exec(body)?.[1];
}

describe("CLOUD-04 the sandbox image", () => {
	test("CLOUD-04 the base image and the sandbox image are pinned by digest", () => {
		for (const line of dockerfile.split("\n").filter((l) => /^\s*FROM\s/.test(l))) {
			expect(line).toContain("@sha256:");
		}
		expect(dockerfile).toContain(IMAGE.base);
		expect(dockerfile).toContain(IMAGE.sandboxImage);
	});

	test("CLOUD-04 every program is at the path the managed-program table names", () => {
		expect(programPath("claude")).toBe(
			`${IMAGE.agentBinariesDir}/claude/${IMAGE.programs.claude.version}/claude`,
		);
		expect(programPath("codex")).toBe(
			`${IMAGE.agentBinariesDir}/codex/${IMAGE.programs.codex.version}/codex`,
		);
		expect(programPath("gh")).toBe(`${IMAGE.agentBinariesDir}/gh/${IMAGE.programs.gh.version}/gh`);
		for (const program of ["claude", "codex", "gh"] as const) {
			expect(dockerfile).toContain(programPath(program));
			expect(dockerfile).toContain(`${IMAGE.binDir}/${program}`);
		}
	});

	test("CLOUD-04 the image pins the same program versions the app pins", () => {
		for (const program of ["claude", "codex", "gh"] as const) {
			expect(pinnedRustVersion(program)).toBe(IMAGE.programs[program].version);
			expect(dockerfile).toContain(IMAGE.programs[program].version);
		}
	});

	test("CLOUD-04 git and ripgrep are installed at a stated version", () => {
		expect(dockerfile).toContain(`git=${IMAGE.gitVersion}`);
		expect(dockerfile).toContain(`ripgrep=${IMAGE.ripgrepVersion}`);
	});

	test("CLOUD-04 the image carries the app's version, so the sidecar's logs name it", () => {
		expect<string>(IMAGE.appVersion).toBe(rootPackage.version);
		expect(dockerfile).toContain(`CONDUCTED_APP_VERSION=${IMAGE.appVersion}`);
	});

	test("CLOUD-04 the image bakes no secret in", () => {
		const secretName = /\b(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b/i;
		const lines = dockerfile.split("\n");
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			const setting = /^\s*(ENV|ARG)\s+(.+)$/.exec(line);
			if (setting?.[2] === undefined) continue;
			expect(secretName.test(setting[2])).toBe(false);
		}
		expect(dockerfile).not.toContain("ANTHROPIC_API_KEY");
		expect(dockerfile).not.toContain("GITHUB_TOKEN");
		expect(dockerfile).not.toContain("GH_TOKEN");
	});

	test("CLOUD-04 the container's main process is our entry script", () => {
		expect(dockerfile).toContain(`COPY build/entry ${IMAGE.entryProgram}`);
		expect(dockerfile).toContain(`ENTRYPOINT ["${IMAGE.entryProgram}"]`);
		expect(dockerfile).toContain(`COPY build/conducted-sidecar ${IMAGE.sidecarProgram}`);
	});

	test("CLOUD-04 the sidecar's helper scripts come from the app's bin folder", () => {
		expect(IMAGE_SCRIPTS).toHaveLength(3);
		for (const script of IMAGE_SCRIPTS) {
			expect(dockerfile).toContain(`build/bin/${script}`);
		}
	});

	test("CLOUD-04 the entry point is compiled for the same baseline Linux target as the sidecar", () => {
		const command = entryCompileArguments("entry.ts", "build/entry");
		expect(command).toContain("bun-linux-x64-baseline");
		expect(command).toContain("build/entry");
	});

	test("CLOUD-04 the build stages the sidecar, the entry and the three scripts", () => {
		const paths = imageInputPaths("/repo");
		expect(paths.sidecar).toBe(CLOUD_BUILD_DEFAULT_OUT);
		expect(paths.entry).toBe("/repo/apps/cloud/sandbox/build/entry");
		expect(paths.binOut).toBe("/repo/apps/cloud/sandbox/build/bin");
		expect(paths.scripts).toEqual(["checkpointer.sh", "git-busy-check.sh", "spotlighter.sh"]);
	});

	test("CLOUD-04 the image installs the Cursor SDK tree where the loader reads it", () => {
		expect(pinnedRustVersion("cursor")).toBe(IMAGE.cursorSdk.version);
		expect<string>(IMAGE.cursorSdk.native).toBe(cursorNativePackageName("linux", "x64"));
		expect(IMAGE.cursorSdk.packages.length).toBeGreaterThan(0);
		for (const package_ of IMAGE.cursorSdk.packages) {
			expect(dockerfile).toContain(`${package_.name}@${package_.version}`);
		}
		expect(dockerfile).toContain(cursorSdkFolder());
		expect(dockerfile).toContain(cursorSdkCurrentLink());
	});

	test("CLOUD-04 the image's SDK layout lets the sidecar's loader start Cursor", async () => {
		const root = await mkdtemp(join(tmpdir(), "cloud04-cursor-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const version = IMAGE.cursorSdk.version;
		const folder = join(root, "cursor", version);
		const modules = join(folder, "node_modules");
		const sdk = join(modules, "@cursor", "sdk");
		await mkdir(join(sdk, "dist", "bundled"), { recursive: true });
		await writeFile(
			join(sdk, "package.json"),
			JSON.stringify({
				name: "@cursor/sdk",
				version,
				type: "module",
				exports: { ".": { bun: "./dist/bundled/index.js" } },
			}),
		);
		await writeFile(
			join(sdk, "dist", "bundled", "index.js"),
			"export function createAgentPlatform() {}\nexport class AuthenticationError extends Error {}\n",
		);
		const native = join(cursorSdkCurrentLinkAt(root), "node_modules", IMAGE.cursorSdk.native);
		const nativeReal = join(modules, IMAGE.cursorSdk.native);
		await mkdir(nativeReal, { recursive: true });
		await writeFile(
			join(nativeReal, "package.json"),
			JSON.stringify({ name: IMAGE.cursorSdk.native, version }),
		);
		await symlink(folder, cursorSdkCurrentLinkAt(root));

		const loader = createCursorSdkLoader({
			agentBinariesDir: root,
			platform: "linux",
			cpu: "x64",
			readText: readTextIfPresent,
			importModule: (entry) => import(entry),
		});
		expect(await loader.locate()).toEqual({
			ok: true,
			value: { folder: cursorSdkCurrentLinkAt(root), version },
		});
		const loaded = await loader.load();
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.value.env).toEqual({
			CURSOR_RIPGREP_PATH: join(native, "bin", "rg"),
			CURSOR_TREE_SITTER_VENDOR_DIR: join(native, "vendor"),
		});
	});
});

/** The image's `cursor/current` link, under the temp root the test lays out. */
function cursorSdkCurrentLinkAt(root: string): string {
	return join(root, "cursor", "current");
}
