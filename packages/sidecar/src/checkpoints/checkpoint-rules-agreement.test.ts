/**
 * @feature SIDE-08 Checkpoints: start before first write, end with file summary
 * Owns: the checkpoint rules the app, the sidecar and bin/checkpointer.sh must share.
 * Behaviour: research/conductor/sessions.md section 7 (id format, ref prefix, exit codes) and
 * services-map.md 3.12.2. Architecture: a rule two runtimes share is written once and compared.
 * Test first: the app's turn checkpoint id, ref prefix and exit codes match the sidecar's and the
 * script's.
 */
import { describe, expect, test } from "bun:test";
import { CHECKPOINT_REF_PREFIX, CHECKPOINTER_EXIT } from "./checkpoint-id.ts";

const SCRIPT = `${import.meta.dir}/../../../../bin/checkpointer.sh`;
const SIDECAR = `${import.meta.dir}/checkpoint-id.ts`;
const APP = `${import.meta.dir}/../../../../apps/desktop/src/core/git/refs.ts`;

/** The id format both runtimes build: session-<sessionId>-turn-<turnId>-<phase>. */
const ID_FORMAT = `session-\${sessionId}-turn-\${turnId}-\${phase}`;
const PHASES = 'export type CheckpointPhase = "start" | "end";';

function exportedString(source: string, name: string): string | undefined {
	return new RegExp(`export const ${name} = "([^"]*)"`).exec(source)?.[1];
}

function exitCodes(source: string): Record<string, number> {
	const block = /export const CHECKPOINTER_EXIT = \{([\s\S]*?)\} as const;/.exec(source)?.[1] ?? "";
	const codes: Record<string, number> = {};
	for (const match of block.matchAll(/(\w+):\s*(\d+)/g)) {
		const name = match[1];
		const value = match[2];
		if (name === undefined || value === undefined) continue;
		codes[name] = Number(value);
	}
	return codes;
}

function hasIdFormat(source: string): boolean {
	return source.includes(ID_FORMAT);
}

function hasPhases(source: string): boolean {
	return source.includes(PHASES);
}

function scriptRefPrefix(script: string): string | undefined {
	return /^REF_PREFIX="([^"]*)"/m.exec(script)?.[1];
}

describe("SIDE-08 checkpoint rules shared by the app, the sidecar and the script", () => {
	test("the app matches the sidecar and the script on prefix, id format, phases and codes", async () => {
		const [script, sidecar, app] = await Promise.all([
			Bun.file(SCRIPT).text(),
			Bun.file(SIDECAR).text(),
			Bun.file(APP).text(),
		]);

		expect(exportedString(app, "CHECKPOINT_REF_PREFIX")).toBe(CHECKPOINT_REF_PREFIX);
		expect(exportedString(sidecar, "CHECKPOINT_REF_PREFIX")).toBe(CHECKPOINT_REF_PREFIX);
		expect(scriptRefPrefix(script)).toBe(CHECKPOINT_REF_PREFIX);

		expect(hasIdFormat(app)).toBe(true);
		expect(hasIdFormat(sidecar)).toBe(true);
		expect(hasPhases(app)).toBe(true);
		expect(hasPhases(sidecar)).toBe(true);

		expect(exitCodes(app)).toEqual({
			busy: CHECKPOINTER_EXIT.skippedMergeOrRebase,
			unmergedIndex: CHECKPOINTER_EXIT.skippedConflicts,
			notToplevel: CHECKPOINTER_EXIT.refusedRootIsAncestor,
		});
		expect(exitCodes(sidecar)).toEqual({
			ok: CHECKPOINTER_EXIT.ok,
			error: CHECKPOINTER_EXIT.error,
			skippedMergeOrRebase: CHECKPOINTER_EXIT.skippedMergeOrRebase,
			skippedConflicts: CHECKPOINTER_EXIT.skippedConflicts,
			refusedRootIsAncestor: CHECKPOINTER_EXIT.refusedRootIsAncestor,
			terminated: CHECKPOINTER_EXIT.terminated,
		});
	});

	test("the agreement check flags a copy that drifts", () => {
		const drifted = `export const CHECKPOINT_REF_PREFIX = "refs/other/";
export const CHECKPOINTER_EXIT = {
	busy: 42,
} as const;
export const turnCheckpointId = (s, t, p) => \`session-\${t}-turn-\${s}-\${p}\`;`;

		expect(exportedString(drifted, "CHECKPOINT_REF_PREFIX")).not.toBe(CHECKPOINT_REF_PREFIX);
		expect(exitCodes(drifted).busy).not.toBe(CHECKPOINTER_EXIT.skippedMergeOrRebase);
		expect(hasIdFormat(drifted)).toBe(false);
		expect(hasPhases(drifted)).toBe(false);
	});
});
