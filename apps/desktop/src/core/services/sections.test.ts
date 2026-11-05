/**
 * @feature NAV-04 Sidebar sections service
 * Owns: tests for the sections service: loading, creating, renaming, moving, reordering and
 * deleting sections, and the two async guards it uses.
 * Test first: placing a workspace in a second section removes it from the first.
 */
import {
	appError,
	err,
	ok,
	type Result,
	type SectionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import type { SectionRepository } from "../db/sections.ts";
import type { Section } from "../model.ts";
import { SectionsService, type SectionsServiceDeps } from "./sections.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const section = (id: string, position: number, workspaceIds: WorkspaceId[] = []): Section => ({
	id: id as SectionId,
	name: id,
	emoji: null,
	position,
	collapsed: false,
	workspaceIds,
});

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("NAV-04 SectionsService", () => {
	it("loads the saved sections in position order", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			must(await service.create("Second", null));
			must(await service.create("First", null));
			must(await service.start());
			expect(service.store.getState().sections.map((row) => row.name)).toEqual(["Second", "First"]);
			expect(service.store.getState().loaded).toBe(true);
		} finally {
			test.close();
		}
	});

	it("placing a workspace in a second section removes it from the first", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			const first = must(await service.create("First", null));
			const second = must(await service.create("Second", null));
			must(await service.place(workspace.id, first.id, 0));
			must(await service.place(workspace.id, second.id, 0));
			const byId = new Map(
				service.store.getState().sections.map((row) => [row.id, row.workspaceIds]),
			);
			expect(byId.get(first.id)).toEqual([]);
			expect(byId.get(second.id)).toEqual([workspace.id]);
		} finally {
			test.close();
		}
	});

	it("an unknown section id returns an error and leaves the list as it was", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			must(await service.create("Review", null));
			const before = service.store.getState().sections;
			const result = await service.place(workspace.id, "missing" as SectionId, 0);
			expect(result.ok).toBe(false);
			expect(service.store.getState().sections).toEqual(before);
		} finally {
			test.close();
		}
	});

	it("deleting a section returns its workspaces to the main list without deleting them", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			must(await service.place(workspace.id, created.id, 0));
			must(await service.remove(created.id));
			expect(service.store.getState().sections).toEqual([]);
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id],
			).toEqual(workspace);
		} finally {
			test.close();
		}
	});

	it("reordering writes the new order and keeps the positions dense", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const first = must(await service.create("First", null));
			const second = must(await service.create("Second", null));
			const third = must(await service.create("Third", null));
			must(await service.reorder([third.id, first.id, second.id]));
			expect(service.store.getState().sections.map((row) => [row.name, row.position])).toEqual([
				["Third", 0],
				["First", 1],
				["Second", 2],
			]);
		} finally {
			test.close();
		}
	});

	it("saves a collapsed section", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const created = must(await service.create("Review", "🔎"));
			must(await service.setCollapsed(created.id, true));
			expect(service.store.getState().sections[0]).toMatchObject({
				emoji: "🔎",
				collapsed: true,
			});
		} finally {
			test.close();
		}
	});

	it("keeps the list unchanged when a create fails", async () => {
		const repo = {
			list: vi.fn(async () => ok([])),
			create: vi.fn(async () => err(appError("db", "The database is locked."))),
		} as unknown as SectionRepository;
		const service = new SectionsService({
			db: {} as Database,
			repos: { sections: repo },
		} satisfies SectionsServiceDeps);
		must(await service.start());
		const result = await service.create("Review", null);
		expect(result.ok).toBe(false);
		expect(service.store.getState().sections).toEqual([]);
	});

	it("keeps only the newest start answer when two reads overlap", async () => {
		const older = deferred<Result<Section[]>>();
		const newer = deferred<Result<Section[]>>();
		const list = vi.fn();
		list.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
		const service = new SectionsService({
			db: {} as Database,
			repos: { sections: { list } as unknown as SectionRepository },
		});
		const first = service.start();
		const second = service.start();
		newer.resolve(ok([section("newer", 0)]));
		await second;
		older.resolve(ok([section("older", 0)]));
		await first;
		expect(service.store.getState().sections.map((row) => row.id)).toEqual(["newer"]);
	});

	it("runs two moves one after the other so the second sees the first", async () => {
		const gate = deferred<void>();
		const calls: string[] = [];
		const repo = {
			list: vi.fn(async () => ok([section("s1", 0), section("s2", 1)])),
			replaceMembers: vi.fn(async (sectionId: SectionId, ids: readonly WorkspaceId[]) => {
				calls.push(`start:${ids.join(",")}`);
				if (sectionId === ("s1" as SectionId)) await gate.promise;
				calls.push("end");
				return ok(undefined);
			}),
		} as unknown as SectionRepository;
		const service = new SectionsService({
			db: {} as Database,
			repos: { sections: repo },
		} satisfies SectionsServiceDeps);
		must(await service.start());
		const first = service.place("w1" as WorkspaceId, "s1" as SectionId, 0);
		const second = service.place("w2" as WorkspaceId, "s1" as SectionId, 1);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toEqual(["start:w1"]);
		gate.resolve();
		must(await first);
		must(await second);
		expect(calls).toEqual(["start:w1", "end", "start:w1,w2", "end"]);
		expect(service.store.getState().sections[0]?.workspaceIds).toEqual(["w1", "w2"]);
	});
});
