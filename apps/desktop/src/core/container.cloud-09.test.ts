// @vitest-environment node
/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the composition-root proof that a cloud workspace's terminal and run-script doors reach
 * the sandbox through the Worker's terminal stream, and that nothing runs on the Mac in their
 * place.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 point 7 (terminals through the sandbox's exec
 * streaming and WebSocket terminal) and services-map.md 5A.4.1 (the terminal backend is chosen by
 * host).
 * Test first: a cloud terminal opens the terminal channel and its start message names the
 * workspace's sandbox folder, while no PTY is spawned on the Mac.
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import type { Workspace } from "./model.ts";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** A ready cloud workspace whose folder the Worker reports as present. */
async function readyCloudWorkspace(test: TestContainer): Promise<Workspace> {
	const workspace = await seedWorkspace(test.container, { host: CLOUD });
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	test.memory.controls.scriptCloud((request) => {
		if (request.path === "/w/vm-1/files") {
			const body = request.body as { operation?: string; path?: string };
			switch (body.operation) {
				case "exists":
					return ok({ status: 200, body: JSON.stringify({ exists: true }) });
				case "stat":
					return ok({
						status: 200,
						body: JSON.stringify({
							stat: {
								path: body.path ?? "/",
								isDirectory: true,
								isSymlink: false,
								size: 0,
								modifiedAt: 0,
							},
						}),
					});
				default:
					return ok({ status: 200, body: "{}" });
			}
		}
		return null;
	});
	return workspace;
}

/** The messages the app sent on one relay, as parsed JSON. */
function sentOn(test: TestContainer, relayId: string): { type?: string; [key: string]: unknown }[] {
	return test.memory.controls.cloudSent
		.filter((entry) => entry.relayId === relayId)
		.map((entry) => JSON.parse(entry.line) as { type?: string });
}

describe("CLOUD-09 cloud terminals in the real container", () => {
	it("opens a sandbox terminal and never a PTY on the Mac", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyCloudWorkspace(test);
			const before = test.memory.controls.ptySpawns.length;
			const created = must(await test.container.services.terminals.create(workspace.id));
			expect(created.workspaceId).toBe(workspace.id);
			expect(test.memory.controls.ptySpawns.length).toBe(before);

			const relayId = test.memory.controls.cloudRelayIds[0];
			expect(relayId).toBeDefined();
			if (relayId === undefined) return;
			expect(test.memory.controls.cloudRelayChannels[relayId]).toBe("terminal");
			const start = sentOn(test, relayId).find((message) => message.type === "start");
			expect(start).toMatchObject({
				type: "start",
				cwd: workspace.path,
				cols: 80,
				rows: 24,
				command: ["/bin/bash", "-l"],
			});

			// Output the sandbox sends reaches the agent's output tool.
			test.memory.controls.emitCloudLine(
				relayId,
				JSON.stringify({ type: "data", data: btoa("deploying\n") }),
			);
			const output = must(
				await test.container.services.terminals.outputFor(workspace.id, "terminal", 100),
			);
			expect(output.output).toContain("deploying");
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("runs a chat command as a sandbox process, not a local one", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyCloudWorkspace(test);
			const calls = test.memory.controls.shellCalls.length;
			const commands = test.memory.controls.ptySpawns.length;
			const run = must(await test.container.services.terminals.runCommand(workspace.id, "echo hi"));
			expect(run.kind).toBe("run");
			expect(test.memory.controls.ptySpawns.length).toBe(commands);
			expect(test.memory.controls.shellCalls.length).toBe(calls);

			const relayId = test.memory.controls.cloudRelayIds[0];
			expect(relayId).toBeDefined();
			if (relayId === undefined) return;
			const start = sentOn(test, relayId).find((message) => message.type === "start");
			expect(start).toMatchObject({
				type: "start",
				cwd: workspace.path,
				command: ["/bin/bash", "-l", "-c", "echo hi"],
			});
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
