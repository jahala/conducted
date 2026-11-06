/**
 * @feature RUN-09 Zsh shell integration for terminals
 * Owns: tests for the zsh shim files, the environment that starts them, the OSC 633 marker reader
 * and the service wiring that writes the shim at app start.
 * Behaviour: native-and-sidecar-map.md A5 and D1; services-map.md 5A.4.6.
 * Test first: an interactive zsh terminal is spawned with ZDOTDIR pointing at the shim folder.
 */
import type { Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { zshIntegrationDir } from "./shell-integration.ts";
import {
	scanShellIntegration,
	shellIntegrationEnv,
	ZSH_INTEGRATION_FILE_NAMES,
	zshIntegrationFiles,
} from "./terminals.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

let open: TestContainer | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
});

async function readyWorkspace(): Promise<{
	test: TestContainer;
	workspace: Awaited<ReturnType<typeof seedWorkspace>>;
}> {
	const test = createTestContainer();
	open = test;
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	return { test, workspace };
}

const start = `${String.fromCharCode(27)}]633;Conducted;`;
const bel = String.fromCharCode(7);

describe("RUN-09 zsh shim files", () => {
	it("has four files that source the user's own file before printing markers", () => {
		const files = zshIntegrationFiles();

		expect(Object.keys(files)).toEqual([...ZSH_INTEGRATION_FILE_NAMES]);
		expect(ZSH_INTEGRATION_FILE_NAMES.length).toBeGreaterThan(0);
		for (const name of ZSH_INTEGRATION_FILE_NAMES) {
			expect(files[name]).toContain(`source "$_conducted_user_zdotdir/${name}"`);
		}
		expect(files[".zshrc"]).toContain("]633;Conducted;");
		expect(files[".zshrc"]).toContain("ProgramStart;");
		expect(files[".zshrc"]).toContain("CommandDone;");
		expect(files[".zshrc"]).toContain("Prompt");
		expect(files[".zshrc"]).toContain("add-zsh-hook preexec");
		expect(files[".zshrc"]).toContain("add-zsh-hook precmd");
	});

	it("starts zsh with the shim folder and leaves finding the user's folder to the shim", () => {
		expect(shellIntegrationEnv("/data/zsh", null)).toEqual({ ZDOTDIR: "/data/zsh" });
		// An empty user folder variable used to send every user to $HOME, whatever their ZDOTDIR.
		expect(shellIntegrationEnv("/data/zsh", null)).not.toHaveProperty("CONDUCTED_USER_ZDOTDIR");
		expect(shellIntegrationEnv("/data/zsh", "/Users/me/dotfiles")).toEqual({
			ZDOTDIR: "/data/zsh",
			CONDUCTED_USER_ZDOTDIR: "/Users/me/dotfiles",
		});
	});
});

describe("RUN-09 reading the OSC 633 markers", () => {
	it("reports a program start, a command done and a prompt, leaving other text alone", () => {
		const scanned = scanShellIntegration(
			"",
			`before ${start}ProgramStart;claude${bel} between ${start}CommandDone;7${bel}${start}Prompt${bel} after`,
		);

		expect(scanned).toEqual({
			events: [
				{ kind: "program_start", program: "claude" },
				{ kind: "command_done", exitCode: 7 },
				{ kind: "prompt" },
			],
			carry: "",
		});
	});

	it("keeps a marker that is split across two chunks", () => {
		const first = scanShellIntegration("", `${start}ProgramSta`);
		expect(first.events).toEqual([]);
		expect(first.carry).toBe(`${start}ProgramSta`);

		const second = scanShellIntegration(first.carry, `rt;codex${bel}`);
		expect(second.events).toEqual([{ kind: "program_start", program: "codex" }]);
		expect(second.carry).toBe("");
	});

	it("keeps a split marker prefix even when only part of the prefix arrived", () => {
		const first = scanShellIntegration("", `text${start.slice(0, 8)}`);
		expect(first.events).toEqual([]);
		expect(first.carry).toBe(start.slice(0, 8));

		const second = scanShellIntegration(first.carry, `${start.slice(8)}Prompt${bel}`);
		expect(second.events).toEqual([{ kind: "prompt" }]);
		expect(second.carry).toBe("");
	});
});

describe("RUN-09 shell integration in the real container", () => {
	it("writes the shim into the app data folder and starts an interactive zsh terminal with it", async () => {
		const { test, workspace } = await readyWorkspace();
		const terminals = test.container.services.terminals;

		must(await terminals.start());

		const dir = zshIntegrationDir(test.container.platform.fs.paths);
		const files = zshIntegrationFiles();
		expect(ZSH_INTEGRATION_FILE_NAMES.length).toBeGreaterThan(0);
		for (const name of ZSH_INTEGRATION_FILE_NAMES) {
			expect(must(await test.container.platform.fs.readText(`${dir}/${name}`))).toBe(files[name]);
		}

		// A file left by an older build is replaced at the next app start.
		must(await test.container.platform.fs.writeTextAtomic(`${dir}/.zshrc`, "stale shim"));
		must(await terminals.start());
		expect(must(await test.container.platform.fs.readText(`${dir}/.zshrc`))).toBe(files[".zshrc"]);

		must(await terminals.create(workspace.id));

		const spawn = test.memory.controls.ptySpawns.at(-1);
		expect(spawn?.env).toMatchObject({ ZDOTDIR: dir });
		expect(spawn?.env).not.toHaveProperty("CONDUCTED_USER_ZDOTDIR");
	});

	it("keeps the running program from the markers, even when a marker is split", async () => {
		const { test, workspace } = await readyWorkspace();
		const terminals = test.container.services.terminals;
		must(await terminals.installShellIntegration());
		const created = must(await terminals.create(workspace.id));
		const connection = terminals.store.getState().connections[created.id];
		if (connection?.state !== "ready") throw new Error("the terminal connection is not ready");

		const seen: Uint8Array[] = [];
		connection.data.onData((chunk) => seen.push(chunk));

		must(await connection.data.write(`${start}ProgramSta`));
		expect(terminals.store.getState().runningProgram[created.id]).toBeUndefined();
		must(await connection.data.write(`rt;claude${bel}`));
		expect(terminals.store.getState().runningProgram[created.id]).toBe("claude");

		must(await connection.data.write(`${start}CommandDone;7${bel}${start}Prompt${bel}`));
		expect(terminals.store.getState().runningProgram[created.id]).toBeNull();

		const output = seen.map((chunk) => new TextDecoder().decode(chunk)).join("");
		expect(output).toBe(
			`${start}ProgramStart;claude${bel}${start}CommandDone;7${bel}${start}Prompt${bel}`,
		);
	});

	it("leaves the shim out of a script terminal", async () => {
		const { test, workspace } = await readyWorkspace();
		const terminals = test.container.services.terminals;
		must(await terminals.installShellIntegration());

		must(
			await terminals.runScript({
				workspaceId: workspace.id,
				kind: "run",
				title: "Dev server",
				command: "bun dev",
				cwd: workspace.path,
				env: { CONDUCTED_PORT: "55010" },
			}),
		);

		const spawn = test.memory.controls.ptySpawns.at(-1);
		expect(spawn?.env?.ZDOTDIR).toBeUndefined();
	});

	it("hands the shim the ZDOTDIR the app was launched with", async () => {
		const { test, workspace } = await readyWorkspace();
		vi.spyOn(test.container.platform.shell, "loginEnv").mockResolvedValue({
			shell: "/bin/zsh",
			path: "/usr/bin:/bin",
			zdotdir: "/Users/me/.config/zsh",
		});
		const terminals = test.container.services.terminals;
		must(await terminals.installShellIntegration());

		must(await terminals.create(workspace.id));

		const spawn = test.memory.controls.ptySpawns.at(-1);
		expect(spawn?.env).toMatchObject({
			ZDOTDIR: zshIntegrationDir(test.container.platform.fs.paths),
			CONDUCTED_USER_ZDOTDIR: "/Users/me/.config/zsh",
		});
	});

	it("leaves the shim out when the login shell is not zsh", async () => {
		const { test, workspace } = await readyWorkspace();
		vi.spyOn(test.container.platform.shell, "loginEnv").mockResolvedValue({
			shell: "/bin/bash",
			path: "/usr/bin:/bin",
			zdotdir: null,
		});
		const terminals = test.container.services.terminals;
		must(await terminals.installShellIntegration());

		must(await terminals.create(workspace.id));

		const spawn = test.memory.controls.ptySpawns.at(-1);
		expect(spawn?.env?.ZDOTDIR).toBeUndefined();
	});
});
