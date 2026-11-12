// @vitest-environment node
/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the composition-root proof that the one create path makes a cloud workspace when the page
 * names the paired Worker: the sandbox is started, the project's GitHub repository is cloned into
 * the workspace's own sandbox folder and the new branch checked out there, the row is saved with
 * the cloud host and with the Advanced setting as its Sync files switch (CLOUD-11), and the first
 * chat starts on the Worker's relay, with no worktree made on the Mac.
 * Behaviour: Conductor's createWorkspaceWithSetup takes its cloud path when the page passes a cloud
 * server URL (main @1171344, `aV` @1109999); our Worker routes are apps/cloud/src/index.ts.
 * Test first: a cloud create clones the project into its own sandbox, saves the cloud host and
 * starts the first chat on the Worker.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { scriptWorker } from "../../test/cloud-worker.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import type { NewWorkspaceInput } from "../api.ts";
import { sessionConfig } from "../db/test-fixtures.ts";

const WORKER = "https://conducted.example.workers.dev";
const WORKSPACE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/**
 * The Mac's answers: no port is listening, no branch is taken, and every other git call succeeds
 * quietly.
 */
function quietMacGit(test: TestContainer): void {
	test.memory.controls.scriptShell((command) => {
		if (command.program === "lsof") return ok({ stdout: "", stderr: "", exitCode: 1 });
		if (command.program !== "git") return null;
		if (command.args.includes("show-ref")) return ok({ stdout: "", stderr: "", exitCode: 1 });
		return ok({ stdout: "", stderr: "", exitCode: 0 });
	});
}

const input = (repoId: NewWorkspaceInput["repoId"], prompt: string): NewWorkspaceInput => ({
	repoId,
	from: { kind: "default" },
	prompt,
	attachmentPaths: [],
	config: { ...sessionConfig, requireToolApproval: false },
	sectionId: null,
	cloudUrl: WORKER,
});

describe("CLOUD-19 the create path in the cloud", () => {
	it("a cloud create clones the project into its own sandbox, saves the cloud host and starts the first chat on the Worker", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.services.settings.start());
			must(await test.container.sidecar.start());
			quietMacGit(test);
			const worker = scriptWorker(test);
			const repo = await seedRepo(test.container, {
				name: "api",
				remoteUrl: "git@github.com:acme/api.git",
			});

			const first = must(
				await test.container.actions.workspaces.create(input(repo.id, "Fix the login bug")),
			);
			const second = must(
				await test.container.actions.workspaces.create(input(repo.id, "Add a health route")),
			);

			for (const created of [first, second]) {
				expect(created.host.kind).toBe("cloud");
				if (created.host.kind !== "cloud") continue;
				expect(created.host.url).toBe(WORKER);
				expect(created.host.vmId).toMatch(WORKSPACE_NAME);
				expect(created.path).toBe(`/workspace/${created.host.vmId}`);
				expect(created.state).toBe("ready");
				const vmId = created.host.vmId;
				expect(worker.started).toContain(vmId);
				const calls = worker.gitCalls.filter((call) => call.vmId === vmId);
				expect(calls).toContainEqual({
					vmId,
					args: ["clone", "--progress", "--", "https://github.com/acme/api.git", "."],
					cwd: created.path,
				});
				expect(calls).toContainEqual({
					vmId,
					args: ["checkout", "-b", created.branch, "origin/main"],
					cwd: created.path,
				});
			}
			expect(first.host).not.toEqual(second.host);

			// Each first chat goes to its own sandbox's sidecar, carrying the cloud host.
			const sends = worker.relayCalls.filter((call) => call.method === "sendMessage");
			expect(sends.map((call) => call.vmId).sort()).toEqual(
				[first, second]
					.map((created) => (created.host.kind === "cloud" ? created.host.vmId : ""))
					.sort(),
			);
			expect(sends).toHaveLength(2);
			for (const send of sends) {
				expect((send.params.workspace as { host: unknown }).host).toMatchObject({
					kind: "cloud",
					url: WORKER,
				});
			}
			// Nothing of a cloud workspace runs on the Mac: no worktree, no call in its folder.
			const macCalls = test.memory.controls.shellCalls;
			expect(macCalls.some((call) => call.args.includes("worktree"))).toBe(false);
			expect(macCalls.some((call) => call.cwd?.startsWith("/workspace") === true)).toBe(false);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("saves the Advanced setting at create time as the new workspace's Sync files switch", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.services.settings.start());
			must(await test.container.sidecar.start());
			quietMacGit(test);
			scriptWorker(test);
			const repo = await seedRepo(test.container, {
				name: "api",
				remoteUrl: "git@github.com:acme/api.git",
			});
			const savedSwitch = async (id: string): Promise<unknown> =>
				(
					await test.database.select<{ remote_file_sync_enabled: number }>(
						"SELECT remote_file_sync_enabled FROM workspaces WHERE id = $1",
						[id],
					)
				)[0]?.remote_file_sync_enabled;

			must(
				await test.container.services.settings.set(
					"auto_sync_files_in_new_cloud_workspaces",
					false,
				),
			);
			const off = must(await test.container.actions.workspaces.create(input(repo.id, "One")));
			must(
				await test.container.services.settings.set("auto_sync_files_in_new_cloud_workspaces", true),
			);
			const on = must(await test.container.actions.workspaces.create(input(repo.id, "Two")));

			expect(await savedSwitch(off.id)).toBe(0);
			expect(await savedSwitch(on.id)).toBe(1);
			// Changing the setting later leaves a workspace that exists alone.
			expect(test.container.services.cloudFileSync.isEnabled(off.id)).toBe(false);
			expect(test.container.services.cloudFileSync.isEnabled(on.id)).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("refuses a project with no GitHub remote before it asks the Worker anything", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.services.settings.start());
			quietMacGit(test);
			const worker = scriptWorker(test);
			const repo = await seedRepo(test.container, { name: "scratch", remoteUrl: null });

			const created = await test.container.actions.workspaces.create(input(repo.id, ""));

			expect(created.ok).toBe(false);
			if (!created.ok) expect(created.error.code).toBe("cloud_repo_not_github");
			expect(worker.requests.filter((request) => request.path.startsWith("/w/"))).toEqual([]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("says the cloud workspace is not reachable when its sandbox does not start, in Conductor's words", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.services.settings.start());
			quietMacGit(test);
			const worker = scriptWorker(test);
			worker.failNextStart();
			const repo = await seedRepo(test.container, {
				name: "api",
				remoteUrl: "https://github.com/acme/api.git",
			});

			const created = await test.container.actions.workspaces.create(input(repo.id, ""));

			expect(created.ok).toBe(false);
			if (!created.ok) {
				expect(created.error.message).toBe(
					"Cloud workspace isn't reachable right now. Try again in a moment.",
				);
			}
			const failed = test.container.services.workspace.store.getState().lastFailedCreate;
			expect(failed?.host.kind).toBe("cloud");
			expect(failed?.state).toBe("failed");
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
