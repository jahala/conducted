/**
 * @feature GIT-10 Checkpointer: save, restore and diff a worktree with private refs
 * Owns: the values that bin/checkpointer.sh and checkpoint-id.ts must agree on.
 * Behaviour: research/conductor/native-and-sidecar-map.md C1 and services-map.md 3.12.2.
 * Test first: the ref prefix and every exit code in checkpoint-id.ts match the script's header.
 */
import { describe, expect, test } from "bun:test";
import { CHECKPOINT_REF_PREFIX, CHECKPOINTER_EXIT } from "./checkpoint-id.ts";

const SCRIPT = `${import.meta.dir}/../../../../bin/checkpointer.sh`;

function scriptRefPrefix(script: string): string | undefined {
	return /^REF_PREFIX="([^"]*)"/m.exec(script)?.[1];
}

function documentedExitCodes(script: string): Map<number, string> {
	const start = script.indexOf("# Exit codes");
	const end = script.indexOf("set -euo pipefail");
	const block = script.slice(start, end);
	const codes = new Map<number, string>();
	for (const line of block.split("\n")) {
		const match = /^#\s+(\d+)\s+(.*)$/.exec(line);
		if (match) codes.set(Number(match[1]), match[2] ?? "");
	}
	return codes;
}

describe("GIT-10 checkpointer constants", () => {
	test("checkpointer.sh and checkpoint-id.ts agree on the ref prefix and exit codes", async () => {
		const script = await Bun.file(SCRIPT).text();
		expect(scriptRefPrefix(script)).toBe(CHECKPOINT_REF_PREFIX);

		const codes = documentedExitCodes(script);
		const meaning = (code: number): string => codes.get(code) ?? "";
		expect(meaning(CHECKPOINTER_EXIT.ok)).toContain("done");
		expect(meaning(CHECKPOINTER_EXIT.error)).toContain("error");
		expect(meaning(CHECKPOINTER_EXIT.skippedMergeOrRebase)).toContain("merge");
		expect(meaning(CHECKPOINTER_EXIT.skippedConflicts)).toContain("conflicts");
		expect(meaning(CHECKPOINTER_EXIT.refusedRootIsAncestor)).toContain("refused");
		expect(meaning(CHECKPOINTER_EXIT.terminated)).toContain("SIGTERM");
	});

	test("the constant check flags a script that disagrees", () => {
		const sample = `REF_PREFIX="refs/other/"\n# Exit codes:\n#   0   done\nset -euo pipefail\n`;
		expect(scriptRefPrefix(sample)).not.toBe(CHECKPOINT_REF_PREFIX);
		expect(documentedExitCodes(sample).has(CHECKPOINTER_EXIT.skippedConflicts)).toBe(false);
	});
});
