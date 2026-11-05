/**
 * @feature DATA-01 The action table covers the whole contract
 * Owns: proving that every group of the `Actions` contract has an implementation, so a screen
 * cannot call a group that the container forgot to wire.
 * Behaviour: api.ts (the contract), services-map.md 1.3 (services behind a facade).
 * Test first: createActions returns an object with every group named in the Actions interface.
 */
import { describe, expect, it } from "vitest";
import { createActions } from "./actions.ts";
import type { Services } from "./container.ts";

const GROUPS = [
	"projects",
	"workspaces",
	"sections",
	"sessions",
	"git",
	"pullRequests",
	"issues",
	"comments",
	"run",
	"terminals",
	"files",
	"artifacts",
	"mcp",
	"attachments",
	"snippets",
	"settings",
	"agents",
	"programs",
	"accounts",
	"app",
];

describe("DATA-01 createActions", () => {
	it("returns an object with every group named in the Actions interface", () => {
		const actions = createActions({} as Services, {} as never);
		expect(Object.keys(actions).sort()).toEqual([...GROUPS].sort());
		for (const group of GROUPS) {
			expect(typeof actions[group as keyof typeof actions]).toBe("object");
		}
	});
});
