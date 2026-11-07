// @vitest-environment node
/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the mirror's one-way sync, its path guard, stale-file removal, the download fallback and
 * the status a screen reads. The memory Platform stands in for the Rust shell exactly as the
 * platform contract checks it.
 */
import type { Host } from "@conducted/protocol";
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { unusedDatabase } from "../../test/memory-platform.ts";
import type { Workspace } from "../model.ts";
import {
	FileSyncService,
	guardedRelativePath,
	OUTSIDE_MIRROR_MESSAGE,
	SYNC_FAILED_LABEL,
	SYNC_OFF_LABEL,
} from "./file-sync.ts";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" };
const WORKSPACE_ID = "ws-1" as WorkspaceId;
const ROOT = "/Users/conducted";

function workspace(host: Host = CLOUD): Workspace {
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
		createdAt: 0,
		updatedAt: 0,
		lastActivityAt: 0,
		prNumber: null,
		prTitle: null,
		prDescription: null,
	} as unknown as Workspace;
}

function harness(options: { autoSync?: boolean } = {}) {
	const memory = createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => crypto.randomUUID() },
		database: unusedDatabase,
	});
	const remote: Record<string, string> = {};
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
				...Object.keys(remote)
					.filter((path) => path.startsWith(`${root}/`))
					.map((path) => ({
						path,
						isDirectory: false,
						isSymlink: false,
						size: Buffer.byteLength(remote[path] ?? ""),
						modifiedAt: 0,
					})),
			];
			return ok({ status: 200, body: JSON.stringify({ entries, truncated: false }) });
		}
		if (body.operation === "read") {
			const text = remote[body.path ?? ""];
			if (text === undefined) return ok({ status: 404, body: "{}" });
			return ok({ status: 200, body: JSON.stringify({ text }) });
		}
		if (body.operation === "write") {
			remote[body.path ?? ""] = String((request.body as { text?: string }).text ?? "");
			return ok({ status: 200, body: "{}" });
		}
		return null;
	});
	const service = new FileSyncService({
		cloud: memory.platform.cloud,
		fs: memory.platform.fs,
		opener: memory.platform.opener,
		workspaceOf: () => ok(workspace()),
		repoNameOf: () => ok("project"),
		rootPath: () => ROOT,
		setting: <T>(key: string): T =>
			(key === "auto_sync_files_in_new_cloud_workspaces" ? (options.autoSync ?? true) : "") as T,
		now: () => 1_700_000_000_000,
	});
	const mirror = `${ROOT}/remote-workspace-sync/project/${WORKSPACE_ID}`;
	return {
		service,
		memory,
		mirror,
		remote,
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

	it("refuses a path that leaves the mirror", () => {
		expect(guardedRelativePath("../outside").ok).toBe(false);
		expect(guardedRelativePath("/etc/passwd").ok).toBe(false);
		expect(guardedRelativePath("a/.git/config").ok).toBe(false);
		expect(guardedRelativePath("src/a.ts")).toEqual(ok("src/a.ts"));
	});

	it("reports Sync files is off when the setting is off and there is no mirror", async () => {
		const h = harness({ autoSync: false });
		const ensured = await h.service.ensureMirror(WORKSPACE_ID);
		expect(ensured.ok).toBe(false);
		expect(h.service.viewOf(WORKSPACE_ID, CLOUD)).toEqual({
			state: "off",
			label: SYNC_OFF_LABEL,
		});
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
});
