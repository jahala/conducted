/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Tests the image's facts against the Dockerfile: a pinned base, the pinned program versions the
 * app pins, the managed-program paths the sidecar reads, and no secret in the image.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	entryCompileArguments,
	IMAGE_SCRIPTS,
	imageInputPaths,
} from "../../apps/cloud/sandbox/build.ts";
import { IMAGE, programPath } from "../../apps/cloud/sandbox/image.ts";
import { CLOUD_BUILD_DEFAULT_OUT } from "../../packages/sidecar/src/cloud-build.ts";

const root = join(import.meta.dir, "../..");
const dockerfile = readFileSync(join(root, "apps/cloud/sandbox/Dockerfile"), "utf8");
const rustSource = readFileSync(join(root, "apps/desktop/src-tauri/src/binaries.rs"), "utf8");
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
	version: string;
};

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
});
