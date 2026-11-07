/**
 * @feature APP-01 Startup sequence
 * Owns: the web UI entry: it builds the container, runs the ordered start, hands the Platform log to
 * the query client's error hooks and mounts the router inside the providers. A notification click
 * opens through NAV-17's deep-link opener, the same one Platform deep links use.
 * Behaviour: services-map.md part 6 (the Platform is built once, the root renders with React error
 * handlers, the gated start runs behind it).
 * Test first: mounting the entry builds a container, runs the startup sequence and renders the router.
 */

import { ok } from "@conducted/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StartedApp, startApp } from "./main.tsx";
import { createMemoryPlatform } from "./platform/memory.ts";
import type { Database } from "./platform/platform.ts";
import { createTestIds } from "./test/ids.ts";
import { openTestDatabase } from "./test/sqlite.ts";

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
			ids: createTestIds(),
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
			ids: createTestIds(),
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

describe("APP-01 entry inputs", () => {
	it("uses the clock, the ids and the history it is given", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);
		const store = openTestDatabase();
		const ids = createTestIds("entry");
		const clock = { now: () => 1_234_000 };
		const memory = createMemoryPlatform({ clock, ids, database: store.database });
		let app!: StartedApp;
		act(() => {
			app = startApp({
				root,
				platform: memory.platform,
				installHandlers: false,
				clock,
				ids,
				history: createMemoryHistory({ initialEntries: ["/settings/general"] }),
			});
		});
		try {
			expect(await app.started).toEqual(ok(undefined));
			await waitFor(() => expect(app.router.state.location.pathname).toBe("/settings/general"));

			const section = await app.container.actions.sections.create("Review", null);
			expect(section.ok && section.value.id.startsWith("entry-")).toBe(true);
			const stored = store.raw.prepare("SELECT created_at FROM sections").all();
			expect(stored).toEqual([{ created_at: 1_234_000 }]);
		} finally {
			await stopApp(app, root);
			store.close();
		}
	});
});

describe("NAV-17 notification clicks from the entry", () => {
	it("open through the deep-link opener: any route it knows, and its toast for a missing workspace", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);
		const memory = createMemoryPlatform({
			clock: { now: () => 1_000 },
			ids: createTestIds(),
			database: emptyDatabase(),
		});
		let app!: StartedApp;
		act(() => {
			app = startApp({ root, platform: memory.platform, installHandlers: false });
		});
		try {
			expect(await app.started).toEqual(ok(undefined));

			act(() => {
				memory.controls.emitNotificationClick("conducted://settings/experimental");
			});
			await waitFor(() =>
				expect(app.router.state.location.pathname).toBe("/settings/experimental"),
			);

			act(() => {
				memory.controls.emitNotificationClick("conducted://workspace?id=gone&session=s1");
			});
			expect(await screen.findByText("Couldn't open workspace")).toBeTruthy();
			expect(app.router.state.location.pathname).toBe("/settings/experimental");
		} finally {
			await stopApp(app, root);
			window.history.replaceState(null, "", "/");
		}
	});
});

describe("APP-01 global handlers", () => {
	it("unmounting the app removes the error handlers it installed", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);
		const memory = createMemoryPlatform({
			clock: { now: () => 1_000 },
			ids: createTestIds(),
			database: emptyDatabase(),
		});
		const consoleError = console.error;
		const removed: string[] = [];
		const removeListener = vi.spyOn(window, "removeEventListener");
		let app!: StartedApp;
		act(() => {
			app = startApp({ root, platform: memory.platform });
		});
		try {
			expect(await app.started).toEqual(ok(undefined));
			expect(console.error).not.toBe(consoleError);
		} finally {
			await stopApp(app, root);
		}
		const restored = console.error === consoleError;
		console.error = consoleError;
		for (const call of removeListener.mock.calls) removed.push(call[0]);
		expect(restored).toBe(true);
		expect(removed).toEqual(expect.arrayContaining(["error", "unhandledrejection"]));
	});
});
