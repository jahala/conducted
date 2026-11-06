/**
 * @feature AGENT-09 Cursor: SDK in process (the compiled sidecar loads packages from disk)
 * Owns: the check that a sidecar compiled with `COMPILE_FLAGS` can import an npm package from a
 * folder on disk whose entry sits in a subfolder, as Cursor's SDK and its dependencies do.
 * Behaviour: a Bun standalone program does not read package.json files at run time unless it is
 * compiled with --compile-autoload-package-json; without it, `@bufbuild/protobuf` (entry
 * `dist/esm/index.js`) is "not found" from the installed SDK. Measured with Bun 1.3.14.
 * Test first: a program compiled with the sidecar's flags imports a package whose entry is
 * `dist/index.js`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COMPILE_FLAGS } from "./packaging.ts";

describe("AGENT-09 the compiled sidecar loads packages from disk", () => {
	let root = "";

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "conducted-compile-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("AGENT-09 a program compiled with the sidecar's flags imports a package whose entry is in a subfolder", async () => {
		const pkg = path.join(root, "tree", "node_modules", "@scope", "lib");
		await mkdir(path.join(pkg, "dist"), { recursive: true });
		await writeFile(
			path.join(pkg, "package.json"),
			JSON.stringify({
				name: "@scope/lib",
				type: "module",
				exports: { ".": { import: "./dist/index.js" } },
			}),
		);
		await writeFile(path.join(pkg, "dist", "index.js"), "export const answer = 42;\n");
		const entry = path.join(root, "tree", "entry.js");
		await writeFile(entry, 'export { answer } from "@scope/lib";\n');
		const probe = path.join(root, "probe.ts");
		await writeFile(
			probe,
			'const loaded = await import(process.argv[2]);\nconsole.log("answer=" + loaded.answer);\n',
		);
		const program = path.join(root, "probe");

		const built = Bun.spawnSync(["bun", "build", probe, ...COMPILE_FLAGS, "--outfile", program], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(built.exitCode).toBe(0);
		const ran = Bun.spawnSync([program, entry], { stdout: "pipe", stderr: "pipe", cwd: root });

		expect(ran.stderr.toString()).toBe("");
		expect(ran.stdout.toString().trim()).toBe("answer=42");
	}, 60_000);
});
