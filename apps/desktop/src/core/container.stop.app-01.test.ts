// @vitest-environment node
/**
 * @feature APP-01 Container stop
 * Behaviour: services-map.md part 6 (startup order), docs/engineering.md (listeners and timers
 * are released).
 * Test first: stop runs every step even when one fails, waits for chat events being stored, and a
 * stop during start ends the start before it wires anything.
 */
import type { SessionEventEnvelope } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { openTestDatabase } from "../test/sqlite.ts";
import { createContainer } from "./container.ts";
import { tomlCodec } from "./services/toml-codec.ts";

const clock = { now: () => 1_000 };

let closeDatabase: (() => void) | null = null;

afterEach(() => {
	vi.restoreAllMocks();
	closeDatabase?.();
	closeDatabase = null;
});

/** A deferred promise, so a test decides when a database call may finish. */
function gate(): { opened: Promise<void>; open: () => void } {
	let open: () => void = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

interface GatedDatabase {
	database: Database;
	/** Resolves when the first gated call has started. */
	entered: Promise<void>;
	release: () => void;
}

/** Wraps the test database so its first `kind` call waits until `release` is called. */
function gatedDatabase(kind: "select" | "transaction"): GatedDatabase {
	const store = openTestDatabase();
	closeDatabase = () => store.close();
	const hold = gate();
	const entry = gate();
	let used = false;
	const waitOnce = async (): Promise<void> => {
		if (used) return;
		used = true;
		entry.open();
		await hold.opened;
	};
	const database: Database = {
		execute: (sql, params) => store.database.execute(sql, params),
		select: async (sql, params) => {
			if (kind === "select") await waitOnce();
			return store.database.select(sql, params);
		},
		transaction: async (work) => {
			if (kind === "transaction") await waitOnce();
			return store.database.transaction(work);
		},
	};
	return { database, entered: entry.opened, release: hold.open };
}

function build(database: Database) {
	let next = 0;
	const ids = { uuid: () => `stop-id-${++next}` };
	const memory = createMemoryPlatform({ clock, ids, database });
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: (taken) => `place-${taken.size}` },
		sound: { play: async () => {} },
		windowFocused: () => true,
		// This test starts no background work, so nothing is reported.
		reportFailure: () => undefined,
		showToast: () => undefined,
		openLink: () => {},
	});
	return { memory, container };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("APP-01 container stop", () => {
	it("runs every stop step when one step throws, and logs the failure", async () => {
		const { memory, container } = build(gatedDatabase("select").database);
		// The failure is the input here: stop must carry on past a step that throws.
		vi.spyOn(container.services.runScripts, "stopAll").mockRejectedValue(new Error("cannot stop"));
		const started = await container.sidecar.start();
		expect(started.ok).toBe(true);
		expect(memory.controls.dispose()).toBeGreaterThan(0);

		await container.stop();

		// The sidecar line and restart listeners are gone, so the step after the failing one ran.
		expect(memory.controls.dispose()).toBe(0);
		const after = await container.sidecar.request("getSessionStatus", {
			sessionId: "s1" as SessionId,
		});
		expect(after).toMatchObject({ ok: false, error: { code: "sidecar_not_started" } });
		expect(
			memory.controls.logs.some((line) => line.message.startsWith("Stopping run scripts")),
		).toBe(true);
	});

	it("waits for a chat event that is being stored before it closes the sidecar connection", async () => {
		const gated = gatedDatabase("transaction");
		const { memory, container } = build(gated.database);
		await container.sidecar.start();
		const envelope: SessionEventEnvelope = {
			sessionId: "gone-chat" as SessionId,
			sequence: 0,
			event: {
				type: "turn_ended",
				eventId: "late-1" as never,
				at: 900,
				turnId: "t1" as never,
				outcome: "interrupted",
			},
		};
		memory.controls.emitSidecarLine(
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "deliverEvent", params: envelope }),
		);
		await gated.entered;

		let stopped = false;
		const stopping = container.stop().then(() => {
			stopped = true;
		});
		await tick();
		expect(stopped).toBe(false);

		gated.release();
		await stopping;

		// The acknowledgement went out before the connection closed.
		const sent = memory.controls.sidecarSent.map((line) => JSON.parse(line) as { method?: string });
		expect(sent.some((message) => message.method === "eventPersisted")).toBe(true);
	});

	it("ends a start that is still running when stop is called, wiring nothing", async () => {
		const gated = gatedDatabase("select");
		const { memory, container } = build(gated.database);

		const starting = container.start();
		await gated.entered;
		const stopping = container.stop();
		gated.release();
		const result = await starting;
		await stopping;

		expect(result).toMatchObject({ ok: false, error: { code: "container_stopped" } });
		expect(memory.controls.dispose()).toBe(0);
		const request = await container.sidecar.request("getSessionStatus", {
			sessionId: "s1" as SessionId,
		});
		expect(request).toMatchObject({ ok: false, error: { code: "sidecar_not_started" } });
	});
});
