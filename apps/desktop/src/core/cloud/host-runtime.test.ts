// @vitest-environment node
/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the shell and file adapter that picks the Worker for a cloud folder and the Mac for every
 * other one. The memory Platform stands in for the Rust shell exactly as the platform contract
 * checks it.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { unusedDatabase } from "../../test/memory-platform.ts";
import { createHostedPlatform } from "./host-runtime.ts";

const CLOUD = { kind: "cloud" as const, url: "https://w.example.dev", vmId: "oslo" };

function platformWithCloud() {
	const memory = createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => crypto.randomUUID() },
		database: unusedDatabase,
	});
	memory.controls.scriptCloud((request) => {
		if (request.path === "/w/oslo/git") {
			return {
				ok: true,
				value: { status: 200, body: '{"exitCode":0,"stdout":"git\\n","stderr":""}' },
			};
		}
		if (request.path === "/w/oslo/exec") {
			return {
				ok: true,
				value: { status: 200, body: '{"exitCode":0,"stdout":"cloud\\n","stderr":""}' },
			};
		}
		if (request.path === "/w/oslo/files") {
			const body = request.body as { operation?: string };
			if (body.operation === "read") {
				return { ok: true, value: { status: 200, body: '{"text":"hello"}' } };
			}
			return { ok: true, value: { status: 200, body: "{}" } };
		}
		return null;
	});
	const hosted = createHostedPlatform(memory.platform, (path) =>
		path.startsWith("/sandbox") ? CLOUD : null,
	);
	return { memory, hosted };
}

describe("CLOUD-03 the hosted shell and file adapter", () => {
	it("sends a cloud command to the Worker and a Mac command to the shell", async () => {
		const { memory, hosted } = platformWithCloud();
		const cloud = await hosted.shell.run({
			program: "bash",
			args: ["-lc", "echo hi"],
			cwd: "/sandbox/workspace",
		});
		expect(cloud.ok && cloud.value.stdout).toBe("cloud\n");
		expect(memory.controls.cloudRequests.at(-1)?.path).toBe("/w/oslo/exec");
		expect(memory.controls.shellCalls).toEqual([]);

		memory.controls.scriptShell(() => ({
			ok: true,
			value: { exitCode: 0, stdout: "mac\n", stderr: "" },
		}));
		const mac = await hosted.shell.run({
			program: "bash",
			args: ["-lc", "echo hi"],
			cwd: "/code/workspace",
		});
		expect(mac.ok && mac.value.stdout).toBe("mac\n");
		expect(memory.controls.shellCalls).toHaveLength(1);
	});

	it("runs git on its own route and starts a cloud command", async () => {
		const { memory, hosted } = platformWithCloud();
		const git = await hosted.shell.run({
			program: "git",
			args: ["status", "--porcelain"],
			cwd: "/sandbox/workspace",
		});
		expect(git.ok && git.value.stdout).toBe("git\n");
		expect(memory.controls.cloudRequests.at(-1)?.path).toBe("/w/oslo/git");

		const running = hosted.shell.start({
			program: "bash",
			args: ["-lc", "echo hi"],
			cwd: "/sandbox/workspace",
		});
		const done = await running.done;
		expect(done.ok && done.value.exitCode).toBe(0);
	});

	it("reads a cloud file from the Worker and a Mac file from the disk", async () => {
		const { memory, hosted } = platformWithCloud();
		const cloud = await hosted.fs.readText("/sandbox/workspace/README.md");
		expect(cloud.ok && cloud.value).toBe("hello");
		expect(memory.controls.cloudRequests.at(-1)?.path).toBe("/w/oslo/files");

		memory.controls.files.set("/code/workspace/README.md", "local");
		const mac = await hosted.fs.readText("/code/workspace/README.md");
		expect(mac.ok && mac.value).toBe("local");
	});
});
