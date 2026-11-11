import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createMemoryPlatform, type MemoryPlatform } from "../platform/memory.ts";
import type { Database, ShellCommand, ShellOutput } from "../platform/platform.ts";
import { createContainer } from "./container.ts";
import { GH_PAT_KEYCHAIN_KEY } from "./services/github.ts";
import { tomlCodec } from "./services/toml-codec.ts";

const unusedDatabase: Database = {
	execute: () => Promise.reject(new Error("PR-01 does not use the database.")),
	select: () => Promise.reject(new Error("PR-01 does not use the database.")),
	transaction: () => Promise.reject(new Error("PR-01 does not use the database.")),
};

const clock = { now: () => 1_000 };
const ids = (() => {
	let next = 0;
	return { uuid: () => `id-${++next}` };
})();

function buildContainer(): {
	container: ReturnType<typeof createContainer>;
	memory: MemoryPlatform;
} {
	const memory = createMemoryPlatform({ clock, ids, database: unusedDatabase });
	// The program manager's ready gh (PLAT-35): no gh command runs without it (D088).
	memory.controls.files.set(`${memory.platform.fs.paths.appData}/bin/gh`, "");
	memory.controls.setProgramStatus({
		program: "gh",
		state: "ready",
		version: "test",
		bytesDownloaded: 0,
		bytesTotal: null,
		attempt: 0,
		nextAttemptAt: null,
		error: null,
		path: `${memory.platform.fs.paths.appData}/bin/gh`,
	});
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: () => "place" },
		sound: { play: async () => {} },
		windowFocused: () => true,
		// This test starts no background work, so nothing is reported.
		reportFailure: () => undefined,
		showToast: () => undefined,
	});
	return { container, memory };
}

const authStatusOutput = {
	exitCode: 0,
	stdout:
		"github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:org'\n",
	stderr: "",
};

function scriptGh(memory: MemoryPlatform, seen: ShellCommand[]): void {
	memory.controls.scriptShell((command): Result<ShellOutput> | null => {
		if (command.program !== "gh") return null;
		seen.push(command);
		if (command.args[0] === "auth") return ok(authStatusOutput);
		if (command.args[0] === "api") return ok({ exitCode: 0, stdout: "octocat\n", stderr: "" });
		if (command.args[0] === "config") return ok({ exitCode: 0, stdout: "https\n", stderr: "" });
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});
}

const validToken = `ghp_${"a".repeat(30)}`;

describe("PR-01 container wiring", () => {
	it("gives GitHub access the Keychain, so a saved token is used by gh", async () => {
		const { container, memory } = buildContainer();
		expect(await container.services.github.setToken(validToken)).toEqual(ok(undefined));
		container.services.settings.store.setState({
			values: { ...container.services.settings.store.getState().values, gh_auth_method: "" },
		});

		const seen: ShellCommand[] = [];
		scriptGh(memory, seen);
		const access = await container.services.github.checkAccess();

		expect(access.ok && access.value).toMatchObject({ status: "ok", usesToken: true });
		expect(seen.length).toBeGreaterThan(0);
		for (const command of seen) {
			expect(command.env?.GH_TOKEN).toBe(validToken);
		}
	});

	it("gives GitHub access the settings, so the gh CLI choice is read", async () => {
		const { container, memory } = buildContainer();
		expect(await container.services.github.setToken(validToken)).toEqual(ok(undefined));
		container.services.settings.store.setState({
			values: { ...container.services.settings.store.getState().values, gh_auth_method: "cli" },
		});

		const seen: ShellCommand[] = [];
		scriptGh(memory, seen);
		const access = await container.services.github.checkAccess();

		expect(access.ok && access.value).toMatchObject({ status: "ok", usesToken: false });
		for (const command of seen) {
			expect(command.env?.GH_TOKEN).toBeUndefined();
		}
		expect(container.services.github.store.getState().health.authMethod).toBe("cli");
	});

	it("PLAT-35 runs gh with the app's bin folder first on PATH, so the managed gh answers", async () => {
		const { container, memory } = buildContainer();
		const seen: ShellCommand[] = [];
		scriptGh(memory, seen);

		await container.services.github.checkAccess();

		expect(seen.length).toBeGreaterThan(0);
		for (const command of seen) {
			expect(command.env?.PATH).toBe(
				`${memory.platform.fs.paths.appData}/bin:/opt/homebrew/bin:/usr/bin:/bin`,
			);
		}
	});

	it("stores the personal access token in the platform Keychain", async () => {
		const { container, memory } = buildContainer();

		expect(await container.services.github.setToken(validToken)).toEqual(ok(undefined));
		expect(await memory.platform.keychain.get(GH_PAT_KEYCHAIN_KEY)).toEqual(ok(validToken));
	});
});
