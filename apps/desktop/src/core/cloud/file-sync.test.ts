// @vitest-environment node
/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the mirror's one-way sync, its path guard, stale-file removal, the download fallback and
 * the status a screen reads. The memory Platform stands in for the Rust shell exactly as the
 * platform contract checks it.
 */
import type { Host } from "@conducted/protocol";
import {
	appError,
	CLOUD_MIRROR_FILE_LIMIT_BYTES,
	err,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { unusedDatabase } from "../../test/memory-platform.ts";
import { SYNC_FAILED_LABEL, SYNC_OFF_LABEL } from "../file-sync-view.ts";
import type { Workspace } from "../model.ts";
import {
	FileSyncService,
	guardedRelativePath,
	initialSyncEnabled,
	OUTSIDE_MIRROR_MESSAGE,
} from "./file-sync.ts";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" };
const WORKSPACE_ID = "ws-1" as WorkspaceId;
const ROOT = "/Users/conducted";

function workspace(remoteFileSyncEnabled: boolean, host: Host = CLOUD): Workspace {
	return {
		id: WORKSPACE_ID,
		repoId: "repo-1",
		directoryName: "oslo",
		path: "/workspace/oslo",
		branch: "oslo",
		branchIsPlaceholder: false,
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		port: 55_000,
		linkedPaths: [],
		host,
		remoteFileSyncEnabled,
		createdAt: 0,
		updatedAt: 0,
		lastActivityAt: 0,
		prNumber: null,
		prTitle: null,
		prDescription: null,
	} as unknown as Workspace;
}

/** The service over the memory Platform, for a cloud workspace whose saved switch is `syncOn`. */
function harness(options: { syncOn?: boolean; failSave?: boolean } = {}) {
	let saved = options.syncOn ?? true;
	const saves: boolean[] = [];
	const memory = createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => crypto.randomUUID() },
		database: unusedDatabase,
	});
	const remote: Record<string, string> = {};
	const remoteBytes: Record<string, Uint8Array> = {};
	let directories = new Set<string>(["/workspace/oslo"]);
	memory.controls.scriptCloud((request) => {
		if (request.path !== "/w/vm-1/files") return null;
		const body = request.body as { operation?: string; path?: string };
		if (body.operation === "list") {
			const root = body.path ?? "";
			const entries = [
				...[...directories]
					.filter((path) => path !== root && path.startsWith(`${root}/`))
					.map((path) => ({
						path,
						isDirectory: true,
						isSymlink: false,
						size: 0,
						modifiedAt: 0,
					})),
				...[...Object.keys(remote), ...Object.keys(remoteBytes)]
					.filter((path) => path.startsWith(`${root}/`))
					.map((path) => ({
						path,
						isDirectory: false,
						isSymlink: false,
						size: remoteBytes[path]?.length ?? Buffer.byteLength(remote[path] ?? ""),
						modifiedAt: 0,
					})),
			];
			return ok({ status: 200, body: JSON.stringify({ entries, truncated: false }) });
		}
		if (body.operation === "read" || body.operation === "readBytes") {
			const path = body.path ?? "";
			const bytes =
				remoteBytes[path] ??
				(remote[path] === undefined ? undefined : new TextEncoder().encode(remote[path]));
			if (bytes === undefined) return ok({ status: 404, body: "{}" });
			if (body.operation === "read") {
				return ok({ status: 200, body: JSON.stringify({ text: new TextDecoder().decode(bytes) }) });
			}
			return ok({
				status: 200,
				body: JSON.stringify({ base64: Buffer.from(bytes).toString("base64") }),
			});
		}
		if (body.operation === "write" || body.operation === "writeBytes") {
			const path = body.path ?? "";
			const bytes = (request.body as { base64?: string }).base64;
			if (bytes !== undefined) {
				remoteBytes[path] = new Uint8Array(Buffer.from(bytes, "base64"));
			} else {
				remote[path] = String((request.body as { text?: string }).text ?? "");
			}
			return ok({ status: 200, body: "{}" });
		}
		return null;
	});
	const service = new FileSyncService({
		cloud: memory.platform.cloud,
		fs: memory.platform.fs,
		opener: memory.platform.opener,
		workspaceOf: () => ok(workspace(saved)),
		repoNameOf: () => ok("project"),
		rootPath: () => ROOT,
		saveEnabled: async (_id, enabled) => {
			if (options.failSave === true) {
				return err(appError("db.failed", "Saving the Sync files switch failed"));
			}
			saves.push(enabled);
			saved = enabled;
			return ok(undefined);
		},
		now: () => 1_700_000_000_000,
	});
	const mirror = `${ROOT}/remote-workspace-sync/project/${WORKSPACE_ID}`;
	return {
		service,
		memory,
		mirror,
		saves,
		remote,
		remoteBytes,
		setDirectories: (paths: string[]) => {
			directories = new Set(paths);
		},
	};
}

describe("CLOUD-11 the local mirror", () => {
	it("writes the sandbox's text files to the mirror and records them", async () => {
		const h = harness();
		h.remote["/workspace/oslo/src/app.ts"] = "export const a = 1;\n";
		h.setDirectories(["/workspace/oslo", "/workspace/oslo/src"]);

		const synced = await h.service.syncNow(WORKSPACE_ID);

		expect(synced.ok).toBe(true);
		expect(h.memory.controls.files.get(`${h.mirror}/src/app.ts`)).toBe("export const a = 1;\n");
		expect(
			JSON.parse(String(h.memory.controls.files.get(`${h.mirror}.sync/baseline.json`))).files,
		).toEqual(["src/app.ts"]);
		expect(h.service.store.getState().byWorkspace[WORKSPACE_ID]?.state).toBe("synced");
	});

	it("removes a file the sandbox no longer has", async () => {
		const h = harness();
		h.remote["/workspace/oslo/a.txt"] = "a";
		h.remote["/workspace/oslo/b.txt"] = "b";
		await h.service.syncNow(WORKSPACE_ID);
		expect(h.memory.controls.files.has(`${h.mirror}/b.txt`)).toBe(true);

		delete h.remote["/workspace/oslo/b.txt"];
		await h.service.syncNow(WORKSPACE_ID);

		expect(h.memory.controls.files.has(`${h.mirror}/b.txt`)).toBe(false);
	});

	it("starts a new cloud workspace's switch at the Advanced setting and a Mac one off", () => {
		expect(initialSyncEnabled(CLOUD, true)).toBe(true);
		expect(initialSyncEnabled(CLOUD, false)).toBe(false);
		expect(initialSyncEnabled({ kind: "local" }, true)).toBe(false);
	});

	it("refuses a path that leaves the mirror", () => {
		expect(guardedRelativePath("../outside").ok).toBe(false);
		expect(guardedRelativePath("/etc/passwd").ok).toBe(false);
		expect(guardedRelativePath("a/.git/config").ok).toBe(false);
		expect(guardedRelativePath("src/a.ts")).toEqual(ok("src/a.ts"));
	});

	it("reports Sync files is off when the workspace's switch is off and there is no mirror", async () => {
		const h = harness({ syncOn: false });
		const ensured = await h.service.ensureMirror(WORKSPACE_ID);
		expect(ensured.ok).toBe(false);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toEqual({
			state: "off",
			label: SYNC_OFF_LABEL,
			description: "Runs against a synced copy on your Mac.",
			mirrorPath: h.mirror,
			enabled: false,
		});
	});

	it("turns the mirror off and on again with the workspace switch", async () => {
		const h = harness();
		h.remote["/workspace/oslo/a.txt"] = "a";
		expect(h.service.isEnabled(WORKSPACE_ID)).toBe(true);
		expect((await h.service.setEnabled(WORKSPACE_ID, true)).ok).toBe(true);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toMatchObject({
			state: "synced",
			enabled: true,
		});
		expect((await h.service.setEnabled(WORKSPACE_ID, false)).ok).toBe(true);
		expect(h.service.isEnabled(WORKSPACE_ID)).toBe(false);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toMatchObject({
			state: "off",
			enabled: false,
		});
		expect((await h.service.setEnabled(WORKSPACE_ID, true)).ok).toBe(true);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toMatchObject({
			state: "synced",
			enabled: true,
		});
		expect(h.saves).toEqual([true, false, true]);
	});

	it("starts nothing and keeps the saved switch when saving it fails", async () => {
		const h = harness({ syncOn: false, failSave: true });
		h.remote["/workspace/oslo/a.txt"] = "a";

		const turned = await h.service.setEnabled(WORKSPACE_ID, true);

		expect(turned.ok).toBe(false);
		expect(!turned.ok && turned.error.message).toBe("Saving the Sync files switch failed");
		expect(h.service.isEnabled(WORKSPACE_ID)).toBe(false);
		expect(h.memory.controls.cloudRequests).toEqual([]);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toMatchObject({ state: "off", enabled: false });
	});

	it("downloads a file the mirror does not hold into Downloads", async () => {
		const h = harness();
		h.remote["/workspace/oslo/notes.txt"] = "hello";
		const revealed = vi.spyOn(h.memory.platform.opener, "revealInFinder");
		const downloaded = await h.service.downloadFile(WORKSPACE_ID, "notes.txt");
		expect(downloaded).toEqual(
			ok({ path: "/Users/conducted/Downloads/notes.txt", downloaded: true }),
		);
		expect(h.memory.controls.files.get("/Users/conducted/Downloads/notes.txt")).toBe("hello");
		expect(revealed).toHaveBeenCalledWith("/Users/conducted/Downloads/notes.txt");
	});

	it("answers Could not open Downloads when Finder refuses", async () => {
		const h = harness();
		h.remote["/workspace/oslo/notes.txt"] = "hello";
		vi.spyOn(h.memory.platform.opener, "revealInFinder").mockRejectedValue(new Error("no Finder"));
		const downloaded = await h.service.downloadFile(WORKSPACE_ID, "notes.txt");
		expect(downloaded.ok).toBe(false);
		if (!downloaded.ok) {
			expect(downloaded.error.message).toBe("Could not open Downloads. Try again.");
		}
	});

	it("reports a failed sync with Sync files failed", async () => {
		const h = harness();
		h.memory.controls.scriptCloud((request) =>
			request.path === "/w/vm-1/files"
				? ok({ status: 500, body: JSON.stringify({ error: "sandbox asleep" }) })
				: null,
		);
		const synced = await h.service.syncNow(WORKSPACE_ID);
		expect(synced.ok).toBe(false);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toMatchObject({
			state: "failed",
			label: SYNC_FAILED_LABEL,
		});
	});

	it("uploading a file outside the synced workspace is refused", async () => {
		const h = harness();
		const uploaded = await h.service.uploadFile(WORKSPACE_ID, "/tmp/a.ts", "../outside");
		expect(uploaded).toEqual({
			ok: false,
			error: expect.objectContaining({ message: OUTSIDE_MIRROR_MESSAGE }),
		});
	});

	it("uploads a Mac file into the sandbox and the mirror", async () => {
		const h = harness();
		h.memory.controls.files.set("/tmp/a.ts", "const a = 1;\n");
		const uploaded: Result<string> = await h.service.uploadFile(
			WORKSPACE_ID,
			"/tmp/a.ts",
			"src/a.ts",
		);
		expect(uploaded.ok).toBe(true);
		expect(h.remote["/workspace/oslo/src/a.ts"]).toBe("const a = 1;\n");
		expect(h.memory.controls.files.get(`${h.mirror}/src/a.ts`)).toBe("const a = 1;\n");
	});

	it("mirrors a binary file byte for byte", async () => {
		const h = harness();
		h.remoteBytes["/workspace/oslo/logo.png"] = new Uint8Array([0x89, 0x50, 0x00, 0xff]);

		const synced = await h.service.syncNow(WORKSPACE_ID);

		expect(synced.ok).toBe(true);
		expect([...(h.memory.controls.blobs.get(`${h.mirror}/logo.png`) ?? [])]).toEqual([
			0x89, 0x50, 0x00, 0xff,
		]);
	});

	it("mirrors a text file larger than 2 MiB", async () => {
		const h = harness();
		const large = "x".repeat(3 * 1024 * 1024);
		h.remote["/workspace/oslo/big.txt"] = large;

		const synced = await h.service.syncNow(WORKSPACE_ID);

		expect(synced.ok).toBe(true);
		expect(h.memory.controls.files.get(`${h.mirror}/big.txt`)).toBe(large);
	});

	it("uploads a binary file into the sandbox", async () => {
		const h = harness();
		h.memory.controls.blobs.set("/tmp/logo.png", new Uint8Array([0x00, 0xff, 0x10]));

		const uploaded = await h.service.uploadFile(WORKSPACE_ID, "/tmp/logo.png", "logo.png");

		expect(uploaded.ok).toBe(true);
		expect([...(h.remoteBytes["/workspace/oslo/logo.png"] ?? [])]).toEqual([0x00, 0xff, 0x10]);
	});

	it("leaves a file over the read limit out and names its size", async () => {
		const h = harness();
		const size = CLOUD_MIRROR_FILE_LIMIT_BYTES + 1;
		h.remoteBytes["/workspace/oslo/video.mp4"] = new Uint8Array(size);

		const synced = await h.service.syncNow(WORKSPACE_ID);

		expect(synced.ok).toBe(true);
		expect(h.memory.controls.blobs.has(`${h.mirror}/video.mp4`)).toBe(false);
		expect(h.memory.controls.files.has(`${h.mirror}/video.mp4`)).toBe(false);
		const baseline = JSON.parse(
			String(h.memory.controls.files.get(`${h.mirror}.sync/baseline.json`)),
		);
		expect(baseline.skipped).toEqual([
			{
				path: "video.mp4",
				reason: expect.stringContaining("cloud read limit"),
				size,
			},
		]);
	});

	it("does not read an oversize file again while its size is unchanged", async () => {
		const h = harness();
		h.remoteBytes["/workspace/oslo/video.mp4"] = new Uint8Array(CLOUD_MIRROR_FILE_LIMIT_BYTES + 1);

		await h.service.syncNow(WORKSPACE_ID);
		await h.service.syncNow(WORKSPACE_ID);

		const reads = h.memory.controls.cloudRequests.filter((request) => {
			const body = request.body as { operation?: string; path?: string };
			return body.operation === "readBytes" && body.path === "/workspace/oslo/video.mp4";
		});
		expect(reads).toHaveLength(0);
	});
});
