/**
 * @feature test support The in-memory platform for tests that only read its shape
 * Owns: `memoryPlatformForShape`, a fresh in-memory stand-in with a fixed clock and fresh ids;
 * `unusedDatabase`, a database that refuses every call; and `platformMethods`, the platform's
 * methods as `group.name`. They serve tests that list or compare the platform's methods and never
 * touch storage.
 * Behaviour: platform/memory.ts is the stand-in; the platform contract runs every case on it and on
 * the Tauri adapter, so the two cannot drift.
 * Contract test: ../platform/contract.test.ts
 * Must handle: every call hands out a new id, so two platforms never share one; the database
 * refuses with a message that says the test does not use it.
 */
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database, Platform } from "../platform/platform.ts";

const refuse = (): Promise<never> =>
	Promise.reject(new Error("This test reads the platform's shape and does not use the database."));

export const unusedDatabase: Database = {
	execute: refuse,
	select: refuse,
	transaction: refuse,
};

/** A memory Platform over an unused database, for a test that only needs the cloud stand-in. */
export function cloudMemoryPlatform() {
	return createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => crypto.randomUUID() },
		database: unusedDatabase,
	});
}

export function memoryPlatformForShape(): Platform {
	let idCounter = 0;
	return createMemoryPlatform({
		clock: { now: () => 0 },
		ids: { uuid: () => `id-${++idCounter}` },
		database: unusedDatabase,
	}).platform;
}

/** Every method of a platform, as `group.name`. */
export const platformMethods = (platform: Platform): string[] =>
	Object.entries(platform).flatMap(([group, value]) =>
		Object.entries(value as object)
			.filter(([, member]) => typeof member === "function")
			.map(([name]) => `${group}.${name}`),
	);
