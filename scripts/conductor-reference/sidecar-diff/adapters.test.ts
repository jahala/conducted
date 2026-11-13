/**
 * The differential run's calls to our sidecar, checked against our protocol's own schemas, so a
 * protocol change that the adapter misses fails here and not as a rejected call in the run.
 */
import { describe, expect, test } from "bun:test";
import { appToSidecarRequests } from "../../../packages/protocol/src/rpc.ts";
import { ourAdapter, type RunContext } from "./adapters.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { Seal } from "./seal.ts";

const seal: Seal = {
	root: "/tmp/sdiff",
	home: "/tmp/sdiff/home",
	tmp: "/tmp/sdiff/tmp",
	fakeBin: "/tmp/sdiff/bin",
	data: "/tmp/sdiff/data",
	repo: "/tmp/sdiff/repo",
	agentLog: "/tmp/sdiff/agent.log",
	profile: "/tmp/sdiff/profile.sb",
	env: {},
};

describe("ourAdapter", () => {
	for (const scenario of SCENARIOS) {
		test(`${scenario.id}: every call is one our protocol accepts`, () => {
			const ctx: RunContext = { seal, scenario, turn: 0, lastTurnId: undefined };
			for (const step of scenario.steps) {
				const call = ourAdapter.call(step, ctx);
				if (call === undefined) continue;
				const spec = appToSidecarRequests[call.method as keyof typeof appToSidecarRequests];
				expect(spec, `${call.method} is one of our requests`).toBeDefined();
				const parsed = spec.params.safeParse(call.params);
				expect(parsed.error?.issues ?? [], `${scenario.id} ${step.do}`).toEqual([]);
			}
		});
	}
});
