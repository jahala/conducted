// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import type { RepoId, SectionId, WorkspaceId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { type BacklogWorkspaceRow, backlogWorkspaceFromRow } from "./backlog-workspaces.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleRepo, sampleSession } from "./test-fixtures.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let repositories: Repositories;
let now: number;
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	now = 1000;
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: { uuid: () => `generated-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

const seedRepo = (): void => {
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
};

const newEntry = (sectionId: SectionId | null = null) => ({
	repoId: sampleRepo.id,
	displayName: "Later",
	prompt: "Add a retry to the uploader",
	attachmentPaths: ["/tmp/a.png"],
	config: sampleSession.config,
	sectionId,
});

const createEntry = async () => must(await repositories.backlogWorkspaces.create(newEntry()));

describe("DATA-08 backlog workspace mapping", () => {
	it("returns an error when the config is not a valid SessionConfig", () => {
		const row: BacklogWorkspaceRow = {
			id: "ws-1" as WorkspaceId,
			repo_id: sampleRepo.id,
			display_name: null,
			prompt: "p",
			attachment_paths: "[]",
			config: "{}",
			section_id: null,
			created_at: 1,
			updated_at: 1,
		};
		expect(backlogWorkspaceFromRow(row)).toMatchObject({
			ok: false,
			error: { code: "db.invalid_json" },
		});
	});

	it("returns an error when the attachment list is not JSON", () => {
		const row: BacklogWorkspaceRow = {
			id: "ws-1" as WorkspaceId,
			repo_id: sampleRepo.id,
			display_name: null,
			prompt: "p",
			attachment_paths: "not json",
			config: JSON.stringify(sampleSession.config),
			section_id: null,
			created_at: 1,
			updated_at: 1,
		};
		expect(backlogWorkspaceFromRow(row)).toMatchObject({
			ok: false,
			error: { code: "db.invalid_json" },
		});
	});
});

describe("DATA-08 backlog workspaces repository", () => {
	it("creates, lists and reads an entry with new ids and times", async () => {
		seedRepo();
		now = 2000;
		const created = await createEntry();
		expect(created).toEqual({
			id: "generated-1",
			...newEntry(),
			createdAt: 2000,
			updatedAt: 2000,
		});
		expect(must(await repositories.backlogWorkspaces.get(created.id))).toEqual(created);
		expect(must(await repositories.backlogWorkspaces.list())).toEqual([created]);
		expect(
			must(await repositories.backlogWorkspaces.list()).filter(
				(entry) => entry.repoId === sampleRepo.id,
			),
		).toEqual([created]);
		expect(
			must(await repositories.backlogWorkspaces.list()).filter(
				(entry) => entry.repoId === ("other" as RepoId),
			),
		).toHaveLength(0);
		expect(must(await repositories.backlogWorkspaces.get("missing" as WorkspaceId))).toBeNull();
	});

	it("lists the oldest entry first", async () => {
		seedRepo();
		now = 2000;
		const first = await createEntry();
		now = 3000;
		const second = await createEntry();
		expect(must(await repositories.backlogWorkspaces.list()).map((entry) => entry.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("clears an entry's section link when the section is deleted", async () => {
		seedRepo();
		const section = must(await repositories.sections.create({ name: "Later", emoji: null }));
		const created = must(await repositories.backlogWorkspaces.create(newEntry(section.id)));
		expect(must(await repositories.backlogWorkspaces.get(created.id))?.sectionId).toBe(section.id);
		must(await repositories.sections.delete(section.id));
		expect(must(await repositories.backlogWorkspaces.get(created.id))?.sectionId).toBeNull();
	});
	it("keeps an entry with no repository when its repo is removed, and deletes one on its own", async () => {
		seedRepo();
		const created = await createEntry();
		must(await repositories.repos.delete(sampleRepo.id));
		expect(must(await repositories.backlogWorkspaces.list())).toHaveLength(1);
		expect(must(await repositories.backlogWorkspaces.get(created.id))).toMatchObject({
			repoId: null,
			prompt: "Add a retry to the uploader",
		});

		seedRepo();
		const second = await createEntry();
		must(await repositories.backlogWorkspaces.delete(second.id));
		expect(must(await repositories.backlogWorkspaces.get(second.id))).toBeNull();
		expect(created.id).not.toBe(second.id);
	});

	it("gives an entry with no repository a repository again", async () => {
		seedRepo();
		const created = await createEntry();
		must(await repositories.repos.delete(sampleRepo.id));
		seedRepo();
		now = 2000;
		must(await repositories.backlogWorkspaces.setRepo(created.id, sampleRepo.id));
		expect(must(await repositories.backlogWorkspaces.get(created.id))).toMatchObject({
			repoId: sampleRepo.id,
			updatedAt: 2000,
		});
		const missing = await repositories.backlogWorkspaces.setRepo(
			"missing" as WorkspaceId,
			sampleRepo.id,
		);
		expect(missing.ok).toBe(false);
	});
});
