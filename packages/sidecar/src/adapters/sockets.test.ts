/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * Owns: tests for the socket edge against a real temp folder.
 * Test first: the socket path lands in the temp folder and carries the pid it was given.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNodeSocketAdapters, createSocketAdapters } from "./sockets.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempFolder(): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), "conducted-socket-adapter-"));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	return folder;
}

describe("SIDE-25 socket edge", () => {
	test("SIDE-25 the socket path lands in the temp folder and carries the pid it was given", async () => {
		const folder = await tempFolder();
		const sockets = createSocketAdapters({ tempRoot: () => folder, pid: () => 4321 });
		expect(sockets.path()).toBe(path.join(folder, "conducted-sidecar-4321.sock"));
	});

	test("SIDE-25 a temp folder with a trailing slash never doubles the separator", async () => {
		const folder = await tempFolder();
		const sockets = createSocketAdapters({ tempRoot: () => `${folder}/`, pid: () => 7 });
		expect(sockets.path()).toBe(path.join(folder, "conducted-sidecar-7.sock"));
	});

	test("SIDE-25 the production socket path lands in the OS temp folder for this process", () => {
		const sockets = createNodeSocketAdapters();
		expect(sockets.path()).toBe(path.join(tmpdir(), `conducted-sidecar-${process.pid}.sock`));
	});
});
