/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: tests over the real container of the search behind the '#' menu: the notice for each
 * GitHub state that stops a list, a list that fails while another answers, and the row limit.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues), services-map.md 5B.8.2.
 * Test first: with `gh` missing, the search says to install it and lists no GitHub rows.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { githubSetupNeeded, PR_MENTION_LIMIT } from "../mention-search.ts";
import type { GithubAccess } from "./github.ts";
import { searchPrMentions } from "./mention-search.ts";

const REMOTE = "https://github.com/octo/repo.git";

const CONNECTED: GithubAccess = {
	status: "ok",
	login: "octo",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "https",
};

const pull = (number: number) => ({
	number,
	title: `Pull ${number}`,
	html_url: `https://github.com/octo/repo/pull/${number}`,
	state: "open",
	updated_at: "2026-11-05T10:00:00Z",
	body: "",
	head: { ref: `branch-${number}` },
	user: { login: "octo" },
});

const issue = {
	number: 7,
	title: "Search drops the last letter",
	html_url: "https://github.com/octo/repo/issues/7",
	state: "open",
	updated_at: "2026-11-05T10:00:00Z",
	body: "",
	user: { login: "octo" },
};

const shellOutput = (stdout: string, exitCode = 0): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr: exitCode === 0 ? "" : "HTTP 500: server error" });

const opened: TestContainer[] = [];

afterEach(() => {
	for (const test of opened.splice(0)) test.close();
});

async function setup(options: {
	access?: GithubAccess;
	remoteUrl?: string | null;
	pulls?: number;
	pullsFail?: boolean;
}) {
	const test = createTestContainer();
	opened.push(test);
	const repo = await seedRepo(
		test.container,
		options.remoteUrl === null ? {} : { remoteUrl: options.remoteUrl ?? REMOTE },
	);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	test.container.services.github.store.setState((state) => ({
		...state,
		access: options.access ?? CONNECTED,
	}));
	test.memory.controls.scriptShell((command) => {
		const args = command.args.join(" ");
		if (command.program !== "gh") return null;
		if (args.includes("pulls?")) {
			if (options.pullsFail === true) return shellOutput("", 1);
			const count = options.pulls ?? 1;
			return shellOutput(JSON.stringify(Array.from({ length: count }, (_, at) => pull(at + 1))));
		}
		if (args.includes("issues?")) return shellOutput(JSON.stringify([issue]));
		return null;
	});
	return { test, workspace };
}

const search = async (test: TestContainer, workspaceId: WorkspaceId) => {
	const found = await searchPrMentions(test.container.services, workspaceId, "");
	if (!found.ok) throw new Error(found.error.message);
	return found.value;
};

describe("COMP-05 the '#' menu's search", () => {
	it("says to install gh when it is missing, and lists no GitHub rows", async () => {
		const { test, workspace } = await setup({ access: { status: "gh_missing" } });

		const found = await search(test, workspace.id);

		expect(found.notice).toBe("Install GitHub CLI (gh) to list pull requests and issues.");
		expect(found.items).toEqual([]);
	});

	it("says the network is down when GitHub is offline", async () => {
		const { test, workspace } = await setup({ access: { status: "offline" } });

		const found = await search(test, workspace.id);

		expect(found.notice).toBe("You're offline. Pull requests and issues can't be listed.");
	});

	it("says the project has no GitHub remote", async () => {
		const { test, workspace } = await setup({ remoteUrl: null });

		const found = await search(test, workspace.id);

		expect(found.notice).toBe("This project has no GitHub remote.");
	});

	it("keeps the issues and names the failure when the pull request list fails", async () => {
		const { test, workspace } = await setup({ pullsFail: true });

		const found = await search(test, workspace.id);

		expect(found.items.map((item) => item.identifier)).toEqual(["#7"]);
		expect(found.notice).toBe("HTTP 500: server error");
	});

	it(`shows at most ${PR_MENTION_LIMIT} rows`, async () => {
		const { test, workspace } = await setup({ pulls: PR_MENTION_LIMIT + 5 });

		const found = await search(test, workspace.id);

		expect(found.items).toHaveLength(PR_MENTION_LIMIT);
		expect(found.notice).toBeUndefined();
	});

	it("names the setup each GitHub sign-in state needs, for the '#' menu and Link issue alike", () => {
		expect(githubSetupNeeded({ state: "signed_out" })).toBe("signed_out");
		expect(githubSetupNeeded({ state: "unknown", reason: "check_failed" })).toBeNull();
		expect(githubSetupNeeded({ state: "unknown", reason: "offline" })).toBe("offline");
	});
});
