// @vitest-environment node
import type { SnippetId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "./repositories.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let now: number;
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
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

const byId = async (id: SnippetId) =>
	must(await repositories.snippets.list()).find((snippet) => snippet.id === id) ?? null;

describe("DATA-08 snippets repository", () => {
	it("creates a snippet with a new id and both times", async () => {
		const created = must(
			await repositories.snippets.create({
				name: "Review",
				keyword: "rev",
				prompt: "Review this change.",
			}),
		);
		expect(created).toEqual({
			id: "generated-1",
			name: "Review",
			keyword: "rev",
			prompt: "Review this change.",
			createdAt: 1000,
			updatedAt: 1000,
		});
		expect(await byId(created.id)).toEqual(created);
		expect(
			must(await repositories.snippets.list()).find((snippet) => snippet.keyword === "rev"),
		).toEqual(created);
		expect(await byId("missing" as SnippetId)).toBeNull();
		expect(
			must(await repositories.snippets.list()).find((snippet) => snippet.keyword === "other"),
		).toBeUndefined();
	});

	it("refuses a duplicate keyword and allows two snippets with no keyword", async () => {
		must(
			await repositories.snippets.create({
				name: "Review",
				keyword: "rev",
				prompt: "Review this change.",
			}),
		);
		expect(
			await repositories.snippets.create({
				name: "Again",
				keyword: "rev",
				prompt: "Another prompt.",
			}),
		).toMatchObject({ ok: false, error: { code: "db.conflict" } });

		must(await repositories.snippets.create({ name: "One", keyword: null, prompt: "First." }));
		must(await repositories.snippets.create({ name: "Two", keyword: null, prompt: "Second." }));
		expect(must(await repositories.snippets.list())).toHaveLength(3);
	});

	it("lists by name ignoring case and keeps ids apart", async () => {
		must(await repositories.snippets.create({ name: "beta", keyword: null, prompt: "b" }));
		must(await repositories.snippets.create({ name: "Alpha", keyword: null, prompt: "a" }));
		must(await repositories.snippets.create({ name: "gamma", keyword: null, prompt: "g" }));
		const listed = must(await repositories.snippets.list());
		expect(listed.map((snippet) => snippet.name)).toEqual(["Alpha", "beta", "gamma"]);
		expect(new Set(listed.map((snippet) => snippet.id)).size).toBe(3);
	});

	it("updates every field and moves updated_at, refusing a duplicate keyword", async () => {
		const first = must(
			await repositories.snippets.create({ name: "First", keyword: "one", prompt: "Old." }),
		);
		const second = must(
			await repositories.snippets.create({ name: "Second", keyword: "two", prompt: "Keep." }),
		);
		now = 2000;
		must(
			await repositories.snippets.update(first.id, {
				name: "Renamed",
				keyword: null,
				prompt: "New.",
			}),
		);
		expect(await byId(first.id)).toMatchObject({
			name: "Renamed",
			keyword: null,
			prompt: "New.",
			createdAt: 1000,
			updatedAt: 2000,
		});

		expect(
			await repositories.snippets.update(first.id, {
				name: "Renamed",
				keyword: "two",
				prompt: "New.",
			}),
		).toMatchObject({ ok: false, error: { code: "db.conflict" } });
		expect((await byId(second.id))?.keyword).toBe("two");

		expect(
			await repositories.snippets.update("missing" as SnippetId, {
				name: "Gone",
				keyword: null,
				prompt: "x",
			}),
		).toMatchObject({ ok: false, error: { code: "db.not_found" } });
	});

	it("deletes a snippet", async () => {
		const created = must(
			await repositories.snippets.create({ name: "Review", keyword: "rev", prompt: "Review." }),
		);
		must(await repositories.snippets.delete(created.id));
		expect(await byId(created.id)).toBeNull();
		expect(must(await repositories.snippets.list())).toHaveLength(0);
	});
});
