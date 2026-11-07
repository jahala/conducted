// @vitest-environment node
/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Tests the real composition root: a cloud workspace's Open in generates the Mac's key, installs
 * its public half through the Worker, starts the local SSH listener, writes the `conducted`
 * config and runs Cursor with `--remote ssh-remote+<host>`. "Copy SSH command" returns the text
 * Conductor copies. Nothing of it touches the Mac's own SSH files: the Platform's home is the
 * in-memory one.
 * Test first: the Worker receives the public key and the config names 127.0.0.1.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { type SshHostEntry, sshConfigText, sshHostnames } from "../cloud/ssh.ts";

const CLOUD = { kind: "cloud" as const, url: "https://w.example.dev", vmId: "vm-1" };

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

/** The main and per-app config paths in the in-memory home. */
function configPaths(test: TestContainer) {
	const home = test.memory.platform.fs.paths.home;
	const ssh = `${home}/.ssh`;
	return {
		keyPath: `${home}/.conducted/ssh/id_ed25519`,
		app: `${ssh}/conducted_config.d/ssh.config`,
		main: `${ssh}/conducted_config`,
		user: `${ssh}/config`,
	};
}

async function cloudWorkspaceWithKey(test: TestContainer) {
	const workspace = await seedWorkspace(test.container, {
		directoryName: "oslo",
		branch: "jahala/oslo",
		path: "/workspace/oslo",
		host: CLOUD,
	});
	const paths = configPaths(test);
	test.memory.controls.scriptShell((command) => {
		if (command.program === "ssh-keygen") {
			test.memory.controls.files.set(`${paths.keyPath}.pub`, "ssh-ed25519 AAAATEST conducted\n");
			return ok({ stdout: "", stderr: "", exitCode: 0 });
		}
		if (command.program === "ssh" && command.args[0] === "-Q") {
			return ok({
				stdout: "sntrup761x25519-sha512@openssh.com\ncurve25519-sha256\n",
				stderr: "",
				exitCode: 0,
			});
		}
		if (command.program === "cursor" || command.program === "code") {
			return ok({ stdout: "", stderr: "", exitCode: 0 });
		}
		return null;
	});
	test.memory.controls.scriptCloud((request) => {
		if (request.path === "/w/vm-1/ssh-key") return ok({ status: 200, body: '{"installed":true}' });
		return null;
	});
	return { workspace, paths };
}

describe("CLOUD-12 a cloud workspace's SSH door", () => {
	it("installs the Mac's public key, starts the listener and opens Cursor over SSH", async () => {
		const test = createTestContainer();
		try {
			const { workspace, paths } = await cloudWorkspaceWithKey(test);
			const opened = await test.container.services.workspace.openIn(workspace.id, "Cursor");
			expect(opened).toMatchObject({ ok: true });

			const install = test.memory.controls.cloudRequests.find(
				(request) => request.path === "/w/vm-1/ssh-key",
			);
			expect(install?.body).toEqual({ publicKey: "ssh-ed25519 AAAATEST conducted" });

			const forwards = must(await test.memory.platform.portForward.list());
			expect(forwards).toHaveLength(1);
			expect(forwards[0]).toMatchObject({ remotePort: 22 });
			expect(forwards[0]?.forwardId.startsWith(`ssh:${workspace.id}:`)).toBe(true);

			const config = test.memory.controls.files.get(paths.app) ?? "";
			expect(config).toContain("Host oslo.conducted jahala-oslo.conducted");
			expect(config).toContain("HostName 127.0.0.1");
			expect(config).toContain(`Port ${forwards[0]?.localPort}`);
			expect(config).toContain(`IdentityFile ${paths.keyPath}`);
			expect(config).toContain("KexAlgorithms ^sntrup761x25519-sha512@openssh.com");
			expect(config).toContain("StrictHostKeyChecking no");
			expect(config).toContain("UserKnownHostsFile /dev/null");
			expect(test.memory.controls.files.get(paths.main)).toContain(`Include ${paths.app}`);
			expect(test.memory.controls.files.get(paths.user)).toContain(`Include ${paths.main}`);

			expect(test.memory.controls.remoteOpens).toEqual([
				{ appName: "Cursor", host: "oslo.conducted", path: "/workspace/oslo" },
			]);
		} finally {
			test.close();
		}
	});

	it("uses the key named by ssh_key_path and names it in the config", async () => {
		const test = createTestContainer();
		try {
			const { workspace, paths } = await cloudWorkspaceWithKey(test);
			const home = test.memory.platform.fs.paths.home;
			const custom = `${home}/keys/custom`;
			test.memory.controls.files.set(custom, "");
			test.memory.controls.files.set(`${custom}.pub`, "ssh-ed25519 CUSTOMKEY conducted\n");
			test.container.services.settings.store.setState({
				values: { ssh_key_path: custom },
			});

			const opened = await test.container.services.workspace.openIn(workspace.id, "Cursor");
			expect(opened).toMatchObject({ ok: true });

			const install = test.memory.controls.cloudRequests.find(
				(request) => request.path === "/w/vm-1/ssh-key",
			);
			expect(install?.body).toEqual({ publicKey: "ssh-ed25519 CUSTOMKEY conducted" });
			const config = test.memory.controls.files.get(paths.app) ?? "";
			expect(config).toContain(`IdentityFile ${custom}`);
			expect(test.memory.controls.files.has(paths.keyPath)).toBe(false);
			expect(
				test.memory.controls.shellCalls.filter((call) => call.program === "ssh-keygen"),
			).toHaveLength(0);
		} finally {
			test.close();
		}
	});

	it("refuses a custom key with no .pub file in Conductor's words", async () => {
		const test = createTestContainer();
		try {
			const { workspace } = await cloudWorkspaceWithKey(test);
			const home = test.memory.platform.fs.paths.home;
			const missing = `${home}/keys/missing`;
			test.memory.controls.files.set(missing, "");
			test.container.services.settings.store.setState({
				values: { ssh_key_path: missing },
			});

			const opened = await test.container.services.workspace.openIn(workspace.id, "Cursor");
			expect(opened).toMatchObject({
				ok: false,
				error: {
					code: "ssh_key_missing",
					message: `Custom SSH public key not found at ${missing}.pub`,
				},
			});
			expect(test.memory.controls.cloudRequests).toHaveLength(0);
		} finally {
			test.close();
		}
	});

	it("adds the include to an existing config without replacing it", async () => {
		const test = createTestContainer();
		try {
			const { workspace, paths } = await cloudWorkspaceWithKey(test);
			const existing = "Host github.com\n    User git\n";
			test.memory.controls.files.set(paths.user, existing);
			must(await test.container.services.workspace.copySshCommand(workspace.id));
			const after = test.memory.controls.files.get(paths.user) ?? "";
			expect(after).toContain(existing);
			expect(after.startsWith(`Include ${paths.main}`)).toBe(true);
		} finally {
			test.close();
		}
	});

	it("returns the text Copy SSH command puts on the clipboard", async () => {
		const test = createTestContainer();
		try {
			const { workspace } = await cloudWorkspaceWithKey(test);
			const command = must(await test.container.services.workspace.copySshCommand(workspace.id));
			expect(command).toBe("ssh oslo.conducted");
		} finally {
			test.close();
		}
	});

	it("refuses an app that cannot open a remote folder, with Conductor's words", async () => {
		const test = createTestContainer();
		try {
			const { workspace } = await cloudWorkspaceWithKey(test);
			const opened = await test.container.services.workspace.openIn(workspace.id, "Finder");
			expect(opened.ok).toBe(false);
			if (!opened.ok) {
				expect(opened.error.code).toBe("remote_open_unsupported");
				expect(opened.error.message).toBe(
					"Remote open is only supported for VS Code, Cursor, and Zed",
				);
			}
			expect(test.memory.controls.cloudRequests).toHaveLength(0);
		} finally {
			test.close();
		}
	});
});

describe("CLOUD-12 the SSH config text", () => {
	it("writes one loopback block per entry and keeps the user's file", () => {
		expect(sshHostnames({ directoryName: "oslo", branch: "jahala/oslo" })).toEqual([
			"oslo",
			"jahala-oslo",
		]);
		expect(sshHostnames({ directoryName: "oslo", branch: "oslo" })).toEqual(["oslo"]);
		const entries: SshHostEntry[] = [{ hostnames: ["oslo"], localPort: 20_001 }];
		const text = sshConfigText({ entries, keyPath: "/k", postQuantum: false });
		expect(text).toContain("Host oslo.conducted");
		expect(text).toContain("HostName 127.0.0.1");
		expect(text).toContain("Port 20001");
		expect(text).not.toContain("KexAlgorithms");
	});
});
