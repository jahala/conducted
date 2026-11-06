/**
 * @feature APP-01 Startup sequence
 * Owns: the web UI entry: it builds the container, runs the ordered start, hands the Platform log to
 * the query client's error hooks and mounts the router inside the providers.
 * Behaviour: services-map.md part 6 (the Platform is built once, the root renders with React error
 * handlers, the gated start runs behind it).
 * Test first: mounting the entry builds a container, runs the startup sequence and renders the router.
 */

import { ok } from "@conducted/shared";
import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StartedApp, startApp } from "./main.tsx";
import { createMemoryPlatform } from "./platform/memory.ts";
import type { Database } from "./platform/platform.ts";

/** Stubs the run scripts and sidecar stop placeholders, then unmounts. */
async function stopApp(app: StartedApp, root: HTMLElement): Promise<void> {
	vi.spyOn(app.container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	vi.spyOn(app.container.sidecar, "stop").mockImplementation(() => {});
	await app.container.stop();
	app.unmount();
	root.remove();
}

function emptyDatabase(): Database {
	const database: Database = {
		execute: async () => ({ rowsAffected: 0 }),
		select: async <Row,>() => [] as Row[],
		transaction: async <T,>(work: (tx: Database) => Promise<T>) => work(database),
	};
	return database;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("APP-01 entry", () => {
	it("mounts the entry, builds the container and runs the startup sequence", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);
		const memory = createMemoryPlatform({
			clock: { now: () => 1_000 },
			ids: { uuid: () => "id" },
			database: emptyDatabase(),
		});
		let app!: StartedApp;

		act(() => {
			app = startApp({
				root,
				platform: memory.platform,
				installHandlers: false,
			});
		});

		expect(root.firstChild).not.toBeNull();
		expect(app.container.platform).toBe(memory.platform);

		// Every step of the ordered start ran and none failed: no startup failure reached the log.
		expect(await app.started).toEqual(ok(undefined));
		expect(memory.controls.logs.filter((line) => line.message.startsWith("Startup"))).toEqual([]);

		await stopApp(app, root);
	});

	it("writes a failed query to the app log through the query client", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);
		const memory = createMemoryPlatform({
			clock: { now: () => 1_000 },
			ids: { uuid: () => "id" },
			database: emptyDatabase(),
		});
		let app!: StartedApp;

		act(() => {
			app = startApp({
				root,
				platform: memory.platform,
				installHandlers: false,
			});
		});

		await app.queryClient
			.fetchQuery({
				queryKey: ["entry-probe"],
				queryFn: async () => {
					throw new Error("the query broke");
				},
			})
			.catch(() => undefined);

		await vi.waitFor(() =>
			expect(memory.controls.logs.some((line) => line.message === "Query failed")).toBe(true),
		);

		await app.started;
		await stopApp(app, root);
	});
});
