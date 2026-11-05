import type { IdSource, Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createOptimisticStore } from "./optimistic.ts";

const ids = (): IdSource => {
	let next = 0;
	return {
		uuid: () => {
			next += 1;
			return `overlay-${next}`;
		},
	};
};

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe("APP-11 optimistic overlay", () => {
	it("shows a rename while the action runs and rolls it back when the action fails", async () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		const gate = deferred<Result<{ name: string }, string>>();

		const run = store.run({
			update: (state) => ({ ...state, name: "new" }),
			action: () => gate.promise,
		});

		expect(store.read()).toEqual({ name: "new" });
		expect(store.canonical()).toEqual({ name: "old" });

		gate.resolve({ ok: false, error: "denied" });
		const result = await run;

		expect(result).toEqual({ ok: false, error: "denied" });
		expect(store.read()).toEqual({ name: "old" });
		expect(store.canonical()).toEqual({ name: "old" });
	});

	it("drops only the failed overlay when two are pending", async () => {
		const store = createOptimisticStore({ name: "old", starred: false }, ids());
		const failing = deferred<Result<{ name: string; starred: boolean }, string>>();
		const other = deferred<Result<{ name: string; starred: boolean }, string>>();

		const first = store.run({
			update: (state) => ({ ...state, name: "renamed" }),
			action: () => failing.promise,
		});
		const second = store.run({
			update: (state) => ({ ...state, starred: true }),
			action: () => other.promise,
		});

		expect(store.read()).toEqual({ name: "renamed", starred: true });

		failing.resolve({ ok: false, error: "nope" });
		await first;
		expect(store.read()).toEqual({ name: "old", starred: true });

		other.resolve({ ok: false, error: "also nope" });
		await second;
		expect(store.read()).toEqual({ name: "old", starred: false });
	});

	it("replaces the canonical state with the action result", async () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		const run = store.run({
			update: (state) => ({ ...state, name: "new" }),
			action: async () => ({ ok: true as const, value: { name: "server" } }),
		});

		await run;
		expect(store.canonical()).toEqual({ name: "server" });
		expect(store.read()).toEqual({ name: "server" });
	});

	it("applies both overlapping successes, so the newest result wins", async () => {
		const store = createOptimisticStore({ name: "old", starred: false }, ids());
		const first = deferred<Result<{ name: string; starred: boolean }, string>>();
		const second = deferred<Result<{ name: string; starred: boolean }, string>>();

		const firstRun = store.run({
			update: (state) => ({ ...state, name: "renamed" }),
			action: () => first.promise,
		});
		const secondRun = store.run({
			update: (state) => ({ ...state, starred: true }),
			action: () => second.promise,
		});

		first.resolve({ ok: true, value: { name: "renamed", starred: false } });
		await firstRun;
		expect(store.canonical()).toEqual({ name: "renamed", starred: false });
		expect(store.read()).toEqual({ name: "renamed", starred: true });

		second.resolve({ ok: true, value: { name: "renamed", starred: true } });
		await secondRun;
		expect(store.canonical()).toEqual({ name: "renamed", starred: true });
		expect(store.read()).toEqual({ name: "renamed", starred: true });
	});

	it("drops an older action's result that arrives after a newer action's result", async () => {
		const store = createOptimisticStore({ name: "old", starred: false }, ids());
		const first = deferred<Result<{ name: string; starred: boolean }, string>>();
		const second = deferred<Result<{ name: string; starred: boolean }, string>>();

		const firstRun = store.run({
			update: (state) => ({ ...state, name: "renamed" }),
			action: () => first.promise,
		});
		const secondRun = store.run({
			update: (state) => ({ ...state, starred: true }),
			action: () => second.promise,
		});

		second.resolve({ ok: true, value: { name: "renamed", starred: true } });
		await secondRun;
		first.resolve({ ok: true, value: { name: "renamed", starred: false } });
		await firstRun;

		expect(store.canonical()).toEqual({ name: "renamed", starred: true });
		expect(store.read()).toEqual({ name: "renamed", starred: true });
	});

	it("keeps a newer canonical state that arrives before the action ends", async () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		const gate = deferred<Result<{ name: string }, string>>();

		const run = store.run({
			update: (state) => ({ ...state, name: "optimistic" }),
			action: () => gate.promise,
		});
		expect(store.read().name).toBe("optimistic");

		store.setCanonical({ name: "pushed" });
		expect(store.read().name).toBe("optimistic");

		gate.resolve({ ok: true, value: { name: "action" } });
		await run;

		expect(store.canonical()).toEqual({ name: "pushed" });
		expect(store.read()).toEqual({ name: "pushed" });
	});

	it("stops before the action when the update throws", async () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		let ran = false;

		await expect(
			store.run({
				update: () => {
					throw new Error("bad update");
				},
				action: async () => {
					ran = true;
					return { ok: true as const, value: { name: "x" } };
				},
			}),
		).rejects.toThrow("bad update");

		expect(ran).toBe(false);
		expect(store.read()).toEqual({ name: "old" });
	});

	it("drops the overlay when the action rejects", async () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		const gate = deferred<Result<{ name: string }, string>>();

		const run = store.run({
			update: (state) => ({ ...state, name: "new" }),
			action: () => gate.promise,
		});
		expect(store.read().name).toBe("new");

		gate.reject(new Error("timeout"));
		await expect(run).rejects.toThrow("timeout");
		expect(store.read().name).toBe("old");
	});

	it("notifies subscribers until they unsubscribe", () => {
		const store = createOptimisticStore({ name: "old" }, ids());
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});

		store.setCanonical({ name: "next" });
		expect(calls).toBe(1);
		unsubscribe();
		store.setCanonical({ name: "again" });
		expect(calls).toBe(1);
	});
});
