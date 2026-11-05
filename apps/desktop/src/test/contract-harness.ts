/**
 * @feature test support The vitest harness for the Platform contract
 * Owns: `vitestContractHarness`, the object `runPlatformContract` needs to register its cases as
 * vitest tests. Memory and Tauri runs share it.
 * Behaviour: not applicable, test support only.
 * Must handle: a skipped case shows its reason in the test name, so the run output names every
 * case the run could not do.
 * Test first: a case the run skips appears in the output with its reason.
 */
import { describe, expect, it } from "vitest";
import type { ContractHarness } from "./platform-contract.ts";

export const vitestContractHarness: ContractHarness = {
	describe: (name, body) => {
		describe(name, body);
	},
	it: (name, body) => {
		it(name, body);
	},
	skip: (name, reason) => {
		it.skip(`${name} (${reason})`, () => {});
	},
	assert: (condition, message) => {
		expect(condition, message).toBe(true);
	},
};
