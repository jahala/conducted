/**
 * @feature DATA-01 The action table covers the whole contract
 * Owns: proving that every group of the `Actions` contract has an implementation and that each
 * action reaches the service method it names, so a screen cannot call a group the container
 * forgot to wire.
 * Behaviour: api.ts (the contract), services-map.md 1.3 (services behind a facade).
 * Test first: createActions returns an object with every group named in the Actions interface,
 * and one action per group reaches its service method.
 */
import { ok } from "@conducted/shared";
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

interface RecordedCall {
	path: string;
	args: readonly unknown[];
}

/** A service tree that records every method call and answers with `ok(undefined)`. */
function recordingTree(calls: RecordedCall[], path = ""): unknown {
	return new Proxy(function recording() {}, {
		get(_target, property) {
			if (typeof property !== "string") return undefined;
			return recordingTree(calls, path === "" ? property : `${path}.${property}`);
		},
		apply(_target, _thisArg, args: unknown[]) {
			calls.push({ path, args });
			return Promise.resolve(ok(undefined));
		},
	});
}

describe("DATA-01 createActions", () => {
	it("returns an object with every group named in the Actions interface", () => {
		const actions = createActions({} as Services, {} as never);
		expect(Object.keys(actions).sort()).toEqual([...GROUPS].sort());
		for (const group of GROUPS) {
			expect(typeof actions[group as keyof typeof actions]).toBe("object");
		}
	});

	it("reaches the service method named by one action in every group", async () => {
		const calls: RecordedCall[] = [];
		const services = recordingTree(calls) as Services;
		const platform = recordingTree(calls) as never;
		const actions = createActions(services, platform);

		const samples: Record<string, { run: () => Promise<unknown>; path: string }> = {
			projects: {
				run: () => actions.projects.addLocal("/code/app"),
				path: "repo.addLocal",
			},
			workspaces: {
				run: () => actions.workspaces.remove("w" as never),
				path: "workspace.remove",
			},
			sections: {
				run: () => actions.sections.remove("sec" as never),
				path: "sections.remove",
			},
			sessions: {
				run: () => actions.sessions.close("s" as never),
				path: "sessions.close",
			},
			git: {
				run: () => actions.git.pull("w" as never),
				path: "git.pull",
			},
			pullRequests: {
				run: () => actions.pullRequests.merge("w" as never),
				path: "github.merge",
			},
			issues: {
				run: () => actions.issues.attachToWorkspace("w" as never, { provider: "github" } as never),
				path: "github.attachIssueToWorkspace",
			},
			comments: {
				run: () => actions.comments.add("w" as never, "a.ts", 1, null, "body"),
				path: "review.add",
			},
			run: {
				run: () => actions.run.start("w" as never, "run"),
				path: "runScripts.start",
			},
			terminals: {
				run: () => actions.terminals.close("t" as never),
				path: "terminals.close",
			},
			files: {
				run: () => actions.files.open("w" as never, "a.ts", "edit", { kind: "branch" }),
				path: "workspaceFiles.open",
			},
			artifacts: {
				run: () => actions.artifacts.loadMore("w" as never),
				path: "workspaceFiles.loadMoreArtifacts",
			},
			mcp: {
				run: () => actions.mcp.refresh("s" as never),
				path: "mcp.refreshSession",
			},
			attachments: {
				run: () => actions.attachments.copyImage("/tmp/a.png"),
				path: "system.copyImage",
			},
			snippets: {
				run: () => actions.snippets.remove("snip" as never),
				path: "composer.removeSnippet",
			},
			settings: {
				run: () => actions.settings.set("theme", "dark"),
				path: "settings.set",
			},
			agents: {
				run: () => actions.agents.refresh(),
				path: "agentCatalog.refresh",
			},
			programs: {
				run: () => actions.programs.install("claude" as never),
				path: "system.installProgram",
			},
			accounts: {
				run: () => actions.accounts.setGitHubToken("token"),
				path: "github.setToken",
			},
			app: {
				run: () => actions.app.copyText("hello"),
				path: "system.copyText",
			},
		};

		for (const group of GROUPS) {
			const sample = samples[group];
			expect(sample, group).toBeDefined();
			if (sample === undefined) continue;
			calls.length = 0;
			await sample.run();
			expect(
				calls.map((call) => call.path),
				group,
			).toEqual([sample.path]);
		}
	});
});
