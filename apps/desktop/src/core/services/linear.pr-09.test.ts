/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: tests for the Linear queries, their cache lifetimes, the key-rejected state, the team
 * filter of the search, the startup access check, the context file and the composition root
 * reaching the service.
 * Behaviour: services-map.md 5B.8.1 (queries and cache times), 5B.8.3 (the context file),
 * ui-map.md 6 (the API key on the Account page).
 * Test first: a 401 moves the state to "key rejected" and a second call makes no request.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "../../platform/platform.ts";
import { createTestContainer } from "../../test/container.ts";
import {
	createLinearHttp,
	LINEAR_API_KEY_KEYCHAIN_KEY,
	LINEAR_BY_ID_CACHE_MS,
	LINEAR_MY_ISSUES_CACHE_MS,
	LINEAR_SEARCH_CACHE_MS,
	LINEAR_TEAM_CACHE_MS,
	type LinearHttp,
	type LinearIssue,
	LinearService,
	linearIssueContextFile,
	linearIssueContextPath,
	linearIssueToView,
} from "./linear.ts";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const WORKSPACE_PATH = "/code/workspaces/linear-test";

type HttpAnswer = Result<{ status: number; json: unknown }>;

interface Call {
	url: string;
	headers: Readonly<Record<string, string>>;
	body: unknown;
}

const issueRaw = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: "issue-uuid-1",
	identifier: "ENG-12",
	title: "The list loses its place",
	description: "Scrolling resets when a new row arrives.",
	url: "https://linear.app/acme/issue/ENG-12",
	createdAt: "2026-11-01T09:00:00.000Z",
	updatedAt: "2026-11-05T10:00:00.000Z",
	branchName: "eng-12-list-place",
	priorityLabel: "High",
	state: { id: "state-1", name: "In progress", type: "started" },
	assignee: { id: "user-1", name: "Ada" },
	labels: { nodes: [{ id: "label-1", name: "Bug" }] },
	team: { id: "team-1", name: "Engineering", key: "ENG" },
	comments: {
		nodes: [
			{
				id: "comment-1",
				body: "I can reproduce this on a long list.",
				createdAt: "2026-11-04T08:30:00.000Z",
				user: { name: "Grace" },
			},
		],
	},
	...overrides,
});

const data = (value: Record<string, unknown>): HttpAnswer =>
	ok({ status: 200, json: { data: value } });

function harness(
	options: {
		key?: string | null;
		answers?: HttpAnswer[];
		now?: () => number;
		workspacePath?: Result<string>;
		writeFails?: boolean;
		http?: LinearHttp;
	} = {},
) {
	const calls: Call[] = [];
	const secrets = new Map<string, string>();
	if (options.key !== undefined && options.key !== null) {
		secrets.set(LINEAR_API_KEY_KEYCHAIN_KEY, options.key);
	}
	const answers = [...(options.answers ?? [])];
	const files = new Map<string, string>();
	const http: LinearHttp = options.http ?? {
		postJson: async (url, headers, body) => {
			calls.push({ url, headers, body });
			const answer = answers.shift();
			if (answer === undefined) {
				return err(appError("linear_test_unscripted", "No answer was scripted."));
			}
			return answer;
		},
	};
	const keychain: Platform["keychain"] = {
		get: async (key) => ok(secrets.get(key) ?? null),
		set: async (key, value) => {
			secrets.set(key, value);
			return ok(undefined);
		},
		delete: async (key) => {
			secrets.delete(key);
			return ok(undefined);
		},
	};
	const service = new LinearService({
		http,
		keychain,
		fs: {
			mkdirp: async () => ok(undefined),
			writeTextAtomic: async (path, text) => {
				if (options.writeFails === true) {
					return err(appError("fs_denied", "The folder cannot be written."));
				}
				files.set(path, text);
				return ok(undefined);
			},
		},
		workspacePathOf: async () => options.workspacePath ?? ok(WORKSPACE_PATH),
		now: options.now ?? (() => NOW),
	});
	return { service, calls, secrets, files, keychain };
}

const bodies = (calls: readonly Call[]): string[] => calls.map((call) => JSON.stringify(call.body));

/** The operation name a request body's query declares, such as "GetUserTeamIds". */
const operationOf = (body: unknown): string => {
	const query = (body as { query?: unknown }).query;
	return typeof query === "string" ? (/query (\w+)/.exec(query)?.[1] ?? "") : "";
};

/** Answers each Linear request by the operation it names, so concurrent calls get the right one. */
function answerByOperation(answers: Record<string, HttpAnswer>, calls: Call[]): LinearHttp {
	return {
		postJson: async (url, headers, body) => {
			calls.push({ url, headers, body });
			return (
				answers[operationOf(body)] ??
				err(appError("linear_test_unscripted", `No answer for ${operationOf(body)}.`))
			);
		},
	};
}

const viewerTeams = data({
	viewer: { teams: { nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }] } },
});

let close: (() => void) | null = null;

afterEach(() => {
	close?.();
	close = null;
});

describe("PR-09 Linear access", () => {
	it("moves to key rejected on a 401 and makes no second request", async () => {
		const test = harness({
			key: "lin_api_bad",
			answers: [ok({ status: 401, json: { message: "Unauthorized" } })],
		});

		const first = await test.service.checkAccess();
		expect(first.ok).toBe(false);
		expect(!first.ok && first.error.code).toBe("linear_key_rejected");
		expect(test.service.store.getState().connection).toBe("key_rejected");

		const second = await test.service.loadMyIssues();
		expect(second.ok).toBe(false);
		expect(!second.ok && second.error.code).toBe("linear_key_rejected");
		expect(test.calls).toHaveLength(1);
	});

	it("makes no request when no key is stored", async () => {
		const test = harness();
		const result = await test.service.loadMyIssues();
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("linear_not_connected");
		expect(test.service.store.getState().connection).toBe("not_connected");
		expect(test.calls).toHaveLength(0);
	});

	it("checks the stored key at startup, so the Account page leaves its loading state", async () => {
		const test = createTestContainer();
		try {
			const { services } = test.container;
			// The services the Linear check does not need stay quiet.
			for (const service of [
				services.repo,
				services.workspace,
				services.sections,
				services.favoriteModels,
				services.terminals,
				services.system,
			]) {
				vi.spyOn(service, "start").mockResolvedValue(ok(undefined) as never);
			}
			vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
			vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
			expect(services.linear.store.getState().connection).toBe("unknown");

			const started = await test.container.start();

			expect(started.ok).toBe(true);
			expect(
				started.ok && started.value.warnings.filter((warning) => warning.step === "linear access"),
			).toEqual([]);
			expect(services.linear.store.getState().connection).toBe("not_connected");
		} finally {
			vi.restoreAllMocks();
			await test.container.stop();
			test.close();
		}
	});

	it("stores a good key and reports the viewer", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [
				data({ viewer: { id: "user-1", name: "Ada", organization: { id: "org", name: "Acme" } } }),
			],
		});
		const result = await test.service.checkAccess();
		expect(result).toEqual(ok({ name: "Ada", organization: "Acme" }));
		expect(test.service.store.getState().account).toEqual({
			name: "Ada",
			organization: "Acme",
		});
		expect(test.calls[0]?.headers.Authorization).toBe("lin_api_good");
	});

	it("saves a new key from the Account page and clears the rejected state", async () => {
		const test = harness({
			answers: [data({ viewer: { id: "user-1", name: "Ada", organization: null } })],
		});
		const saved = await test.service.setApiKey("  lin_api_new  ");
		expect(saved).toEqual(ok(undefined));
		expect(test.secrets.get(LINEAR_API_KEY_KEYCHAIN_KEY)).toBe("lin_api_new");
		expect(test.service.store.getState().connection).toBe("connected");
	});

	it("removes the key when the Account page disconnects", async () => {
		const test = harness({ key: "lin_api_good" });
		const removed = await test.service.setApiKey(null);
		expect(removed).toEqual(ok(undefined));
		expect(test.secrets.has(LINEAR_API_KEY_KEYCHAIN_KEY)).toBe(false);
		expect(test.service.store.getState().connection).toBe("not_connected");
	});
});

describe("PR-09 Linear transport", () => {
	it("sends GraphQL through Platform.http, not a shell", async () => {
		const requests: Parameters<Platform["http"]["fetch"]>[0][] = [];
		const http: Platform["http"] = {
			fetch: async (request) => {
				requests.push(request);
				return ok({
					status: 200,
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ data: { viewer: { id: "user-1" } } }),
				});
			},
			download: () => ({
				id: "download-1",
				done: Promise.resolve(ok({ path: "/tmp/linear", sizeBytes: 0, sha256: "" })),
				cancel: async () => {},
			}),
		};
		const adapter = createLinearHttp(http);
		const result = await adapter.postJson(
			"https://api.linear.app/graphql",
			{ Authorization: "lin_api_good", "Content-Type": "application/json" },
			{ query: "query Viewer { viewer { id } }", variables: {} },
		);
		expect(result).toEqual({
			ok: true,
			value: { status: 200, json: { data: { viewer: { id: "user-1" } } } },
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://api.linear.app/graphql");
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.headers?.Authorization).toBe("lin_api_good");
		expect(requests[0]?.body).toContain("query Viewer");
	});

	it("reports an answer that is not JSON instead of guessing", async () => {
		const http: Platform["http"] = {
			fetch: async () => ok({ status: 200, headers: {}, body: "not json" }),
			download: () => ({
				id: "download-1",
				done: Promise.resolve(ok({ path: "/tmp/linear", sizeBytes: 0, sha256: "" })),
				cancel: async () => {},
			}),
		};
		const result = await createLinearHttp(http).postJson("https://api.linear.app/graphql", {}, {});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("linear_response_invalid");
	});
});

describe("PR-09 Linear queries", () => {
	it("lists my active issues with their comments and times", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [data({ viewer: { id: "user-1", assignedIssues: { nodes: [issueRaw()] } } })],
		});
		const result = await test.service.loadMyIssues();
		expect(result.ok).toBe(true);
		const issue = result.ok ? result.value[0] : undefined;
		expect(issue?.identifier).toBe("ENG-12");
		expect(issue?.comments[0]).toEqual({
			id: "comment-1",
			body: "I can reproduce this on a long list.",
			createdAt: Date.parse("2026-11-04T08:30:00.000Z"),
			user: "Grace",
		});
		expect(issue?.team).toEqual({ id: "team-1", name: "Engineering", key: "ENG" });
		expect(issue?.createdAt).toBe(Date.parse("2026-11-01T09:00:00.000Z"));
		expect(issue?.updatedAt).toBe(Date.parse("2026-11-05T10:00:00.000Z"));
		expect(test.service.store.getState().myIssues).toHaveLength(1);
	});

	it("serves my active issues from the 15 second cache", async () => {
		let now = NOW;
		const test = harness({
			key: "lin_api_good",
			now: () => now,
			answers: [data({ viewer: { id: "user-1", assignedIssues: { nodes: [issueRaw()] } } })],
		});
		await test.service.loadMyIssues();
		now += LINEAR_MY_ISSUES_CACHE_MS - 1;
		const cached = await test.service.loadMyIssues();
		expect(cached.ok).toBe(true);
		expect(test.calls).toHaveLength(1);
		now += 2;
		const renewed = await test.service.loadMyIssues();
		expect(renewed.ok).toBe(false);
		expect(!renewed.ok && renewed.error.code).toBe("linear_test_unscripted");
		expect(test.calls).toHaveLength(2);
	});

	it("runs the search and by-id queries for an identifier and merges the answers", async () => {
		const calls: Call[] = [];
		const test = harness({
			key: "lin_api_good",
			http: answerByOperation(
				{
					GetUserTeamIds: viewerTeams,
					SearchIssuesWithTeamFilter: data({ searchIssues: { nodes: [issueRaw()] } }),
					GetIssueById: data({ issue: issueRaw({ title: "Called directly" }) }),
				},
				calls,
			),
		});
		const result = await test.service.search("ENG-12");
		expect(result.ok).toBe(true);
		expect(result.ok && result.value.map((issue) => issue.title)).toEqual(["Called directly"]);
		expect(calls.map((call) => operationOf(call.body)).sort()).toEqual([
			"GetIssueById",
			"GetUserTeamIds",
			"SearchIssuesWithTeamFilter",
		]);
		const sent = bodies(calls).join("\n");
		expect(sent).toContain("searchIssues");
		expect(sent).toContain("issue(id:");
		expect(sent).toContain("ENG-12");
	});

	it("searches by the identifier in a pasted Linear issue link", async () => {
		const calls: Call[] = [];
		const test = harness({
			key: "lin_api_good",
			http: answerByOperation(
				{
					GetUserTeamIds: viewerTeams,
					SearchIssuesWithTeamFilter: data({ searchIssues: { nodes: [] } }),
					GetIssueById: data({ issue: issueRaw() }),
				},
				calls,
			),
		});
		const result = await test.service.search(
			"  https://linear.app/acme/issue/ENG-12/the-list-loses-its-place  ",
		);
		expect(result.ok && result.value.map((issue) => issue.identifier)).toEqual(["ENG-12"]);
		const variables = calls.map(
			(call) => (call.body as { variables: Record<string, unknown> }).variables,
		);
		expect(variables).toContainEqual({ id: "ENG-12" });
		expect(variables).toContainEqual({ term: "ENG-12", teamIds: ["team-1"] });
	});

	it("keeps a search to the viewer's teams and leaves out completed and canceled issues", async () => {
		const calls: Call[] = [];
		const test = harness({
			key: "lin_api_good",
			http: answerByOperation(
				{
					GetUserTeamIds: viewerTeams,
					SearchIssuesWithTeamFilter: data({ searchIssues: { nodes: [issueRaw()] } }),
				},
				calls,
			),
		});

		const result = await test.service.search("list");

		expect(result.ok && result.value.map((issue) => issue.identifier)).toEqual(["ENG-12"]);
		const search = calls.find((call) => operationOf(call.body) === "SearchIssuesWithTeamFilter");
		const body = search?.body as { query: string; variables: Record<string, unknown> } | undefined;
		expect(body?.variables).toEqual({ term: "list", teamIds: ["team-1"] });
		expect(body?.query).toContain("team: { id: { in: $teamIds } }");
		expect(body?.query).toContain('state: { type: { nin: ["completed", "canceled"] } }');
	});

	it("serves a search from the 15 second cache", async () => {
		let now = NOW;
		const calls: Call[] = [];
		const test = harness({
			key: "lin_api_good",
			now: () => now,
			http: answerByOperation(
				{
					GetUserTeamIds: viewerTeams,
					SearchIssuesWithTeamFilter: data({ searchIssues: { nodes: [issueRaw()] } }),
				},
				calls,
			),
		});
		await test.service.search("list");
		now += LINEAR_SEARCH_CACHE_MS - 1;
		const cached = await test.service.search("list");
		expect(cached.ok).toBe(true);
		expect(calls.map((call) => operationOf(call.body))).toEqual([
			"GetUserTeamIds",
			"SearchIssuesWithTeamFilter",
		]);
	});

	it("serves an issue by id from the 60 second cache", async () => {
		let now = NOW;
		const test = harness({
			key: "lin_api_good",
			now: () => now,
			answers: [data({ issue: issueRaw() })],
		});
		await test.service.getIssue("issue-uuid-1");
		now += LINEAR_BY_ID_CACHE_MS - 1;
		const cached = await test.service.getIssue("issue-uuid-1");
		expect(cached.ok).toBe(true);
		expect(test.calls).toHaveLength(1);
	});

	it("lists team ids and caches them for 10 minutes", async () => {
		let now = NOW;
		const test = harness({
			key: "lin_api_good",
			now: () => now,
			answers: [
				data({ viewer: { teams: { nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }] } } }),
			],
		});
		const first = await test.service.teamIds();
		expect(first).toEqual(ok(["team-1"]));
		now += LINEAR_TEAM_CACHE_MS - 1;
		const cached = await test.service.teamIds();
		expect(cached).toEqual(ok(["team-1"]));
		expect(test.calls).toHaveLength(1);
	});

	it("asks Linear which repositories fit an issue", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [
				data({
					issueRepositorySuggestions: [{ repositoryFullName: "acme/web", confidence: 0.91 }],
				}),
			],
		});
		const result = await test.service.suggestRepositories("issue-uuid-1", ["acme/web"]);
		expect(result).toEqual(ok([{ repositoryFullName: "acme/web", confidence: 0.91 }]));
		expect(bodies(test.calls).join("\n")).toContain("issueRepositorySuggestions");
	});

	it("reports a GraphQL error instead of an empty list", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [ok({ status: 200, json: { errors: [{ message: "Query too complex" }] } })],
		});
		const result = await test.service.search("list");
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("linear_graphql_error");
		expect(test.service.store.getState().myIssues).toEqual([]);
	});

	it("keeps the newest issue list when two reads finish out of order", async () => {
		let releaseFirst: () => void = () => {};
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let index = 0;
		const http: LinearHttp = {
			postJson: async () => {
				index += 1;
				if (index === 1) {
					await first;
					return data({
						viewer: {
							id: "user-1",
							assignedIssues: { nodes: [issueRaw({ id: "older", identifier: "ENG-1" })] },
						},
					});
				}
				return data({
					viewer: {
						id: "user-1",
						assignedIssues: { nodes: [issueRaw({ id: "newer", identifier: "ENG-2" })] },
					},
				});
			},
		};
		const test = harness({ key: "lin_api_good", http });
		const older = test.service.loadMyIssues();
		const newer = test.service.loadMyIssues();
		await newer;
		releaseFirst();
		await older;
		expect(test.service.store.getState().myIssues.map((issue) => issue.id)).toEqual(["newer"]);
	});
});

describe("PR-09 Linear context", () => {
	const issue = (): LinearIssue => {
		const raw = issueRaw();
		return {
			id: String(raw.id),
			identifier: String(raw.identifier),
			title: String(raw.title),
			description: String(raw.description),
			url: String(raw.url),
			branchName: String(raw.branchName),
			createdAt: Date.parse("2026-11-01T09:00:00.000Z"),
			updatedAt: Date.parse("2026-11-05T10:00:00.000Z"),
			state: { name: "In progress", type: "started" },
			assignee: "Ada",
			priorityLabel: "High",
			labels: ["Bug"],
			team: { id: "team-1", name: "Engineering", key: "ENG" },
			comments: [
				{
					id: "comment-1",
					body: "I can reproduce this on a long list.",
					createdAt: Date.parse("2026-11-04T08:30:00.000Z"),
					user: "Grace",
				},
			],
		};
	};

	it("writes [LINEAR]-<identifier>.md under the issue's attachment key", async () => {
		const test = harness();
		const result = await test.service.attachAsContext(issue(), WORKSPACE_PATH);
		const relative = linearIssueContextPath(issue());
		expect(result).toEqual(ok(relative));
		expect(relative).toBe(".context/attachments/linear-issue-uuid-1/[LINEAR]-ENG-12.md");
		const written = test.files.get(`${WORKSPACE_PATH}/${relative}`);
		expect(written).toContain("# ENG-12: The list loses its place");
		expect(written).toContain("Created: 2026-11-01T09:00:00.000Z");
		expect(written).toContain("Updated: 2026-11-05T10:00:00.000Z");
		expect(written).toContain("## Comments");
		expect(written).toContain("Grace - 2026-11-04T08:30:00.000Z");
		expect(written).toContain("I can reproduce this on a long list.");
	});

	it("reports a failed write instead of returning a path", async () => {
		const test = harness({ writeFails: true });
		const result = await test.service.attachAsContext(issue(), WORKSPACE_PATH);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("fs_denied");
	});

	it("fetches the issue and its workspace before attaching it", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [data({ issue: issueRaw() })],
		});
		const result = await test.service.attachToWorkspace(
			"workspace-1" as WorkspaceId,
			"issue-uuid-1",
		);
		expect(result.ok).toBe(true);
		expect([...test.files.keys()][0]).toBe(
			`${WORKSPACE_PATH}/.context/attachments/linear-issue-uuid-1/[LINEAR]-ENG-12.md`,
		);
	});

	it("gives a linked issue as a [LINEAR]-<identifier>.md attachment with its branch name", async () => {
		const test = harness({
			key: "lin_api_good",
			answers: [data({ issue: issueRaw() })],
		});
		const result = await test.service.issueAttachment("issue-uuid-1");
		expect(result).toEqual(
			ok({
				fileName: "[LINEAR]-ENG-12.md",
				text: linearIssueContextFile(issue()),
				branchName: "eng-12-list-place",
			}),
		);
		expect((test.calls[0]?.body as { variables: unknown }).variables).toEqual({
			id: "issue-uuid-1",
		});
	});

	it("reports an issue Linear does not know instead of an empty attachment", async () => {
		const test = harness({ key: "lin_api_good", answers: [data({ issue: null })] });
		const result = await test.service.issueAttachment("ENG-404");
		expect(!result.ok && result.error.code).toBe("linear_issue_not_found");
	});

	it("maps an issue to the screens' issue view with its branch name", () => {
		const view = linearIssueToView(issue());
		expect(view).toEqual({
			provider: "linear",
			id: "issue-uuid-1",
			identifier: "ENG-12",
			title: "The list loses its place",
			url: "https://linear.app/acme/issue/ENG-12",
			state: "In progress",
			branchName: "eng-12-list-place",
			updatedAt: Date.parse("2026-11-05T10:00:00.000Z"),
		});
	});

	it("is reached through the real composition root", async () => {
		const test = createTestContainer();
		close = () => test.close();
		const result = await test.container.services.linear.attachAsContext(issue(), WORKSPACE_PATH);
		const relative = linearIssueContextPath(issue());
		expect(result).toEqual(ok(relative));
		expect(test.memory.controls.files.get(`${WORKSPACE_PATH}/${relative}`)).toContain(
			"# ENG-12: The list loses its place",
		);
	});
});
