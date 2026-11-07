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
	"cloud",
	"portForwards",
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
			cloud: {
				run: () => actions.cloud.unpair(),
				path: "cloudPairing.unpair",
			},
			portForwards: {
				run: () => actions.portForwards.add("w" as never, 3000),
				path: "portForwards.add",
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
	it("reaches exactly one service or platform call from every action", async () => {
		const calls: RecordedCall[] = [];
		const actions = createActions(recordingTree(calls) as Services, recordingTree(calls) as never);
		const leaves: { name: string; run: () => unknown }[] = [];
		const collect = (node: object, path: string): void => {
			for (const [key, value] of Object.entries(node)) {
				const name = `${path}.${key}`;
				if (typeof value === "function") {
					leaves.push({
						name,
						run: () => (value as (...args: unknown[]) => unknown)({}, {}, {}, {}, {}),
					});
				} else if (value !== null && typeof value === "object") {
					collect(value, name);
				}
			}
		};
		collect(actions, "actions");
		expect(leaves.length).toBeGreaterThan(100);

		for (const leaf of leaves) {
			calls.length = 0;
			await leaf.run();
			expect(calls.length, leaf.name).toBe(1);
		}
	});

	it("returns an Err when the link opener or the folder picker rejects", async () => {
		const refusing = {
			opener: {
				openUrl: async () => {
					throw new Error("no handler for that scheme");
				},
			},
			dialogs: {
				pickFolder: async () => {
					throw new Error("the dialog could not open");
				},
			},
		};
		const actions = createActions({} as Services, refusing as never);

		await expect(actions.app.openUrl("weird://x")).resolves.toMatchObject({
			ok: false,
			error: { code: "open_url_failed" },
		});
		await expect(actions.app.pickFolder("Pick")).resolves.toMatchObject({
			ok: false,
			error: { code: "pick_folder_failed" },
		});
	});

	it("returns the chosen folder and null when the picker is cancelled", async () => {
		const answers: (string | null)[] = ["/code/app", null];
		const platform = {
			opener: { openUrl: async () => {} },
			dialogs: { pickFolder: async () => answers.shift() ?? null },
		};
		const actions = createActions({} as Services, platform as never);

		await expect(actions.app.pickFolder("Pick")).resolves.toEqual(ok("/code/app"));
		await expect(actions.app.pickFolder("Pick")).resolves.toEqual(ok(null));
		await expect(actions.app.openUrl("https://example.com")).resolves.toEqual(ok(undefined));
	});

	it("returns the one chosen file and null when the file picker is cancelled", async () => {
		const answers: string[][] = [["/usr/local/bin/claude"], []];
		const asked: { title: string; multiple: boolean }[] = [];
		const platform = {
			dialogs: {
				pickFiles: async (options: { title: string; multiple: boolean }) => {
					asked.push(options);
					return answers.shift() ?? [];
				},
			},
		};
		const actions = createActions({} as Services, platform as never);

		await expect(actions.app.pickFile("Select Claude Code executable")).resolves.toEqual(
			ok("/usr/local/bin/claude"),
		);
		await expect(actions.app.pickFile("Select Claude Code executable")).resolves.toEqual(ok(null));
		expect(asked).toEqual([
			{ title: "Select Claude Code executable", multiple: false },
			{ title: "Select Claude Code executable", multiple: false },
		]);
	});
});
