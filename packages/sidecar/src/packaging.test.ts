import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildAllTargets,
	compileArguments,
	externalBinName,
	printVersion,
	SIDECAR_PROGRAM_NAME,
	SIDECAR_TARGETS,
	SIDECAR_VERSION,
	targetForArch,
	VERSION_FLAG,
	versionLine,
} from "./packaging.ts";

const arm64 = SIDECAR_TARGETS.find((target) => target.arch === "arm64");
const x86_64 = SIDECAR_TARGETS.find((target) => target.arch === "x86_64");

const rustSource = readFileSync(
	join(import.meta.dir, "../../../apps/desktop/src-tauri/src/sidecar.rs"),
	"utf8",
);

describe("SIDE-23 sidecar packaging", () => {
	test("SIDE-23 the version line is the program name and the version", () => {
		expect(versionLine("0.1.0")).toEqual({ ok: true, value: "conducted-sidecar 0.1.0" });
	});

	test("SIDE-23 an empty version is an error value, not a guess", () => {
		for (const empty of ["", "   ", "\n"]) {
			const result = versionLine(empty);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message.toLowerCase()).toContain("version");
		}
	});

	test("SIDE-23 each CPU gets the file name Tauri expects", () => {
		expect(arm64).toBeDefined();
		expect(x86_64).toBeDefined();
		if (arm64 === undefined || x86_64 === undefined) return;
		expect(externalBinName(arm64)).toBe("conducted-sidecar-aarch64-apple-darwin");
		expect(externalBinName(x86_64)).toBe("conducted-sidecar-x86_64-apple-darwin");
	});

	test("SIDE-23 an unknown CPU is an error value that names it", () => {
		const result = targetForArch("riscv64");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("sidecar_unknown_cpu");
			expect(result.error.message).toContain("riscv64");
		}
		expect(targetForArch("arm64").ok).toBe(true);
	});

	test("SIDE-23 the compile command builds one program per CPU", () => {
		expect(arm64).toBeDefined();
		if (arm64 === undefined) return;
		expect(compileArguments(arm64, "dist")).toEqual([
			"bun",
			"build",
			"src/main.ts",
			"--compile",
			"--compile-autoload-package-json",
			"--target",
			"bun-darwin-arm64",
			"--outfile",
			join("dist", "conducted-sidecar-aarch64-apple-darwin"),
		]);
	});

	test("SIDE-23 the build compiles every CPU", () => {
		const commands: (readonly string[])[] = [];
		const code = buildAllTargets("dist", (argv) => {
			commands.push(argv);
			return 0;
		});

		expect(code).toBe(0);
		expect(commands).toEqual(
			SIDECAR_TARGETS.map((target) => [...compileArguments(target, "dist")]),
		);
		expect(commands.map((argv) => argv[argv.length - 1] ?? "")).toEqual([
			join("dist", "conducted-sidecar-aarch64-apple-darwin"),
			join("dist", "conducted-sidecar-x86_64-apple-darwin"),
		]);
	});

	test("SIDE-23 the build stops at the first CPU that fails", () => {
		const commands: (readonly string[])[] = [];
		const code = buildAllTargets("dist", (argv) => {
			commands.push(argv);
			return 7;
		});

		expect(code).toBe(7);
		expect(commands).toHaveLength(1);
	});

	test("SIDE-23 the package build script runs the sidecar builder", () => {
		const packageJson = JSON.parse(
			readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
		) as { scripts?: Record<string, string> };

		expect(packageJson.scripts?.build).toBe("bun src/packaging.ts");
	});

	test("SIDE-23 printVersion writes one version line and exits 0", () => {
		const lines: string[] = [];
		expect(printVersion((text) => lines.push(text))).toBe(0);
		expect(lines).toEqual([`${SIDECAR_PROGRAM_NAME} ${SIDECAR_VERSION}\n`]);
	});

	test("SIDE-23 the entry point prints the version for --version", () => {
		const run = Bun.spawnSync(["bun", "src/main.ts", VERSION_FLAG], {
			cwd: join(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(run.exitCode).toBe(0);
		expect(run.stdout.toString()).toBe(`${SIDECAR_PROGRAM_NAME} ${SIDECAR_VERSION}\n`);
	});
});

describe("SIDE-23 Rust and sidecar contract", () => {
	test("SIDE-23 both runtimes format the same version line", () => {
		const rustName = /pub const SIDECAR_PROGRAM_NAME: &str = "([^"]+)";/.exec(rustSource)?.[1];
		expect(rustName).toBe(SIDECAR_PROGRAM_NAME);
		if (rustName === undefined) return;

		const formatter =
			/pub fn expected_version_line\(app_version: &str\) -> String \{[\s\S]*?\n\}/.exec(
				rustSource,
			)?.[0] ?? "";
		expect(formatter).toContain("SIDECAR_PROGRAM_NAME");
		expect(formatter).not.toContain(`"${rustName}`);

		const line = versionLine("9.9.9");
		expect(line.ok).toBe(true);
		if (line.ok) expect(line.value).toBe(`${rustName} 9.9.9`);

		const run = Bun.spawnSync(["bun", "src/main.ts", VERSION_FLAG], {
			cwd: join(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(run.exitCode).toBe(0);
		expect(run.stdout.toString()).toBe(`${rustName} ${SIDECAR_VERSION}\n`);
	});
});
