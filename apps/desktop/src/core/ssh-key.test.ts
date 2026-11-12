import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTauriPlatform } from "../platform/tauri.ts";
import { createNodeTauriBindings, type NodeTauriRun } from "../test/tauri-node-bindings.ts";
import { customSshKeyMissing, readCustomPublicKey } from "./ssh-key.ts";

let dir: string | null = null;
let run: NodeTauriRun | null = null;

afterEach(async () => {
	await run?.dispose();
	run = null;
	if (dir !== null) rmSync(dir, { recursive: true, force: true });
	dir = null;
});

/** A real shell over the Node-backed bindings, and a key folder outside the app's file folders. */
async function realShell() {
	dir = mkdtempSync(join(tmpdir(), "conducted-ssh-key-"));
	run = createNodeTauriBindings(dir);
	const created = await createTauriPlatform(run.bindings);
	if (!created.ok) throw new Error(created.error.message);
	// A space and a `$` in the path: the shell must take it as one argument, never parse it.
	const keys = join(dir, "outside", "my keys $HOME");
	mkdirSync(keys, { recursive: true });
	return { shell: created.value.shell, keys, cwd: dir };
}

describe("CLOUD-06 readCustomPublicKey", () => {
	it("reads a typed key pair outside the app's file folders through the shell (issue #601)", async () => {
		const { shell, keys, cwd } = await realShell();
		const key = join(keys, "id_e2e");
		writeFileSync(key, "private");
		writeFileSync(`${key}.pub`, "ssh-ed25519 AAAAE2E e2e\n");

		expect(await readCustomPublicKey(shell, key, cwd)).toEqual({
			ok: true,
			value: "ssh-ed25519 AAAAE2E e2e",
		});
	});

	it("answers Conductor's not-found error when either half of the pair is missing", async () => {
		const { shell, keys, cwd } = await realShell();
		const noPublic = join(keys, "no_public");
		writeFileSync(noPublic, "private");
		const noPrivate = join(keys, "no_private");
		writeFileSync(`${noPrivate}.pub`, "ssh-ed25519 AAAAONLY only\n");

		for (const key of [noPublic, noPrivate]) {
			const read = await readCustomPublicKey(shell, key, cwd);
			expect(read.ok).toBe(false);
			expect(!read.ok && read.error).toMatchObject({
				code: "ssh_key_missing",
				message: customSshKeyMissing(key),
			});
		}
	});
});
