/**
 * @feature PLAT-26 Online and offline events
 * Owns: tests for the Tauri system door's connectivity calls: `isOnline` and `onNetworkChanged`.
 * Behaviour: native-and-sidecar-map.md A2, A4 and A5 (the network watcher and the
 * `network-changed` event the UI reconnects on).
 * Test first: a listener hears offline and then online, and stops hearing after it unsubscribes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeTauriBindings, type NodeTauriRun } from "../test/tauri-node-bindings.ts";
import { COMMANDS, createTauriSystem } from "./tauri.ts";

function withBindings(work: (run: NodeTauriRun) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "conducted-plat-26-"));
	const run = createNodeTauriBindings(dir);
	return work(run).finally(async () => {
		await run.dispose();
		rmSync(dir, { recursive: true, force: true });
	});
}

describe("PLAT-26 online and offline events", () => {
	it("asks network_status and returns the state it reports", async () => {
		await withBindings(async (run) => {
			const calls: string[] = [];
			const system = createTauriSystem({
				...run.bindings,
				invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
					calls.push(command);
					return run.bindings.invoke<T>(command, args);
				},
			});

			await expect(system.isOnline()).resolves.toBe(true);
			expect(calls).toEqual([COMMANDS.networkStatus]);
		});
	});

	it("follows offline and online events and stops after unsubscribe", async () => {
		await withBindings(async (run) => {
			const emit = run.controls.emitNetworkChanged;
			if (emit === undefined) throw new Error("the stand-in does not send network changes");
			const system = createTauriSystem(run.bindings);
			const seen: boolean[] = [];
			const stop = system.onNetworkChanged((online) => seen.push(online));

			await emit(false);
			await emit(true);
			expect(seen).toEqual([false, true]);
			await expect(system.isOnline()).resolves.toBe(true);

			stop();
			await emit(false);
			expect(seen).toEqual([false, true]);
		});
	});
});
