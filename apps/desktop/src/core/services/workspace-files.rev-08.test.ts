/**
 * @feature REV-08 File content for the viewer and the editor's unsaved drafts
 * Owns: tests for the workspace file service's draft store, the modified time the viewer polls and
 * the preview URL, over the real container and the in-memory file system.
 * Behaviour: ui-map.md 3.2 ("File changed on disk": "Discard my edits", "Keep mine"),
 * services-map.md 2.5.2 (the open file's modified time is polled).
 * Test first: a draft kept after its file was deleted is written back to disk by the next save.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { fileDraftKey, previewUrlOf } from "./workspace-files.ts";

async function setup(path: string) {
	let now = 1_700_000_000_000;
	const test = createTestContainer({ clock: { now: () => now } });
	const workspace = await seedWorkspace(test.container, { path });
	const absolute = `${workspace.path}/a.ts`;
	const writeDisk = async (text: string): Promise<number> => {
		now += 1_000;
		await test.container.platform.fs.writeTextAtomic(absolute, text);
		return now;
	};
	const firstModifiedAt = await writeDisk("one");
	const service = test.container.services.workspaceFiles;
	const draftOf = () => service.drafts.getState().drafts[fileDraftKey(workspace.id, "a.ts")];
	return { test, workspace, absolute, writeDisk, firstModifiedAt, service, draftOf };
}

describe("REV-08 WorkspaceFilesService drafts", () => {
	it("writes a draft kept after its file was deleted back to disk on save", async () => {
		const { test, workspace, absolute, firstModifiedAt, service, draftOf } = await setup(
			"/code/workspaces/draft-deleted",
		);
		try {
			service.editDraft(workspace.id, "a.ts", "mine", { text: "one", modifiedAt: firstModifiedAt });
			test.memory.controls.files.delete(absolute);
			service.keepDraft(workspace.id, "a.ts", null);
			expect(draftOf()?.keptAfterDelete).toBe(true);

			const saved = await service.saveDraft(workspace.id, "a.ts");

			expect(saved.ok).toBe(true);
			expect(test.memory.controls.files.get(absolute)).toBe("mine");
			expect(draftOf()).toBeUndefined();
		} finally {
			test.close();
		}
	});

	it("drops the drafts of a workspace that leaves the store, and keeps the others", async () => {
		const { test, workspace, firstModifiedAt, service, draftOf } = await setup(
			"/code/workspaces/draft-removed",
		);
		try {
			const other = await seedWorkspace(test.container, { path: "/code/workspaces/draft-other" });
			service.editDraft(workspace.id, "a.ts", "mine", { text: "one", modifiedAt: firstModifiedAt });
			service.editDraft(other.id, "b.ts", "theirs", { text: "", modifiedAt: firstModifiedAt });

			// What the workspace service does when a workspace is deleted (#forgetWorkspace).
			test.container.services.workspace.store.setState((state) => {
				const { [workspace.id]: _removed, ...rest } = state.workspacesById;
				return { workspacesById: rest };
			});

			expect(draftOf()).toBeUndefined();
			expect(service.drafts.getState().drafts[fileDraftKey(other.id, "b.ts")]?.text).toBe("theirs");
		} finally {
			test.close();
		}
	});

	it("drops the draft when an edit gives back the disk text", async () => {
		const { test, workspace, firstModifiedAt, service, draftOf } = await setup(
			"/code/workspaces/draft-back",
		);
		try {
			const disk = { text: "one", modifiedAt: firstModifiedAt };
			service.editDraft(workspace.id, "a.ts", "one!", disk);
			expect(draftOf()?.text).toBe("one!");
			service.editDraft(workspace.id, "a.ts", "one", disk);
			expect(draftOf()).toBeUndefined();
		} finally {
			test.close();
		}
	});

	it("keeps the disk's newer time on Keep mine, so the next save overwrites on purpose", async () => {
		const { test, workspace, absolute, writeDisk, firstModifiedAt, service, draftOf } = await setup(
			"/code/workspaces/draft-keep",
		);
		try {
			service.editDraft(workspace.id, "a.ts", "mine", { text: "one", modifiedAt: firstModifiedAt });
			const theirs = await writeDisk("theirs");

			const refused = await service.saveDraft(workspace.id, "a.ts");
			expect(refused.ok).toBe(false);
			if (!refused.ok) expect(refused.error.code).toBe("changed_on_disk");
			expect(draftOf()?.saveError).toBeNull();

			service.keepDraft(workspace.id, "a.ts", theirs);
			const saved = await service.saveDraft(workspace.id, "a.ts");
			expect(saved.ok).toBe(true);
			expect(test.memory.controls.files.get(absolute)).toBe("mine");
		} finally {
			test.close();
		}
	});

	it("ignores a second save while one runs", async () => {
		const { test, workspace, firstModifiedAt, service } = await setup(
			"/code/workspaces/draft-twice",
		);
		try {
			service.editDraft(workspace.id, "a.ts", "two", { text: "one", modifiedAt: firstModifiedAt });
			const first = service.saveDraft(workspace.id, "a.ts");
			const second = await service.saveDraft(workspace.id, "a.ts");
			expect(second).toEqual({ ok: true, value: null });
			const done = await first;
			expect(done.ok && done.value?.text).toBe("two");
		} finally {
			test.close();
		}
	});

	it("keeps a save failure on the draft for the tab header", async () => {
		const { test, workspace, absolute, firstModifiedAt, service, draftOf } = await setup(
			"/code/workspaces/draft-failed",
		);
		try {
			service.editDraft(workspace.id, "a.ts", "mine", { text: "one", modifiedAt: firstModifiedAt });
			test.memory.controls.files.delete(absolute);

			const saved = await service.saveDraft(workspace.id, "a.ts");

			expect(saved.ok).toBe(false);
			expect(draftOf()?.saving).toBe(false);
			expect(draftOf()?.saveError).toBe('"a.ts" is no longer in the workspace.');
		} finally {
			test.close();
		}
	});
});

describe("REV-08 WorkspaceFilesService modified time and preview URL", () => {
	it("reads the modified time, and null for a deleted file", async () => {
		const { test, workspace, absolute, firstModifiedAt, service } = await setup(
			"/code/workspaces/modified-at",
		);
		try {
			expect(await service.modifiedAtOf(workspace.id, "a.ts")).toEqual({
				ok: true,
				value: firstModifiedAt,
			});
			test.memory.controls.files.delete(absolute);
			expect(await service.modifiedAtOf(workspace.id, "a.ts")).toEqual({ ok: true, value: null });
		} finally {
			test.close();
		}
	});

	it("puts the modified time in the preview URL, so a changed file loads again", () => {
		expect(previewUrlOf("/code/my shots/a.png", 5)).toBe(
			"asset://localhost/%2Fcode%2Fmy%20shots%2Fa.png?v=5",
		);
		expect(previewUrlOf("/code/a.png", 6)).not.toBe(previewUrlOf("/code/a.png", 5));
	});
});
