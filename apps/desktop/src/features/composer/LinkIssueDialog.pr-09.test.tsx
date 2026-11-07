/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: tests over the real container that the Link issue dialog opens from Cmd+I, the '+' menu and
 * the command's other callers; lists, searches and links Linear and GitHub issues to the chat's
 * draft; renames a placeholder branch after the issue; and that removing the chip unlinks the issue.
 * Behaviour: ui-map.md 3.5 ('+' menu 'Link issue' Cmd+I), 3.10 (Linear picker: 'Connect Linear',
 * 'Search issues...', 'No open issues found'), 5.4 (Cmd+I); services-map.md 5B.8.1 (the queries and
 * the 300 ms search debounce), 5B.8.3 (the `[LINEAR]-<identifier>.md` and `[GITHUB]-<n>.md` names).
 * Linear calls go to a local stand-in that answers by GraphQL operation name, never the network.
 * Test first: with Linear connected, Cmd+I opens 'Search issues...', and choosing ENG-12 adds
 * `[LINEAR]-ENG-12.md` to the chat's draft.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok, type Result } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { LINEAR_API_KEY_KEYCHAIN_KEY } from "../../core/services/linear.ts";
import type { HttpRequest, ShellCommand, ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

let current: TestContainer | null = null;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	current?.close();
	current = null;
});

const linearIssue = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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
	labels: { nodes: [] },
	team: { id: "team-1", name: "Engineering", key: "ENG" },
	comments: { nodes: [] },
	...overrides,
});

type Operation =
	| "Viewer"
	| "MyActiveIssues"
	| "GetUserTeamIds"
	| "SearchIssuesWithTeamFilter"
	| "GetIssueById";

/** Linear's stand-in: answers each GraphQL request with the data scripted for its operation name. */
function linearStandIn(
	test: TestContainer,
	answers: Partial<Record<Operation, unknown>>,
): { calls: { operation: string; variables: Record<string, unknown> }[] } {
	const calls: { operation: string; variables: Record<string, unknown> }[] = [];
	test.memory.platform.http.fetch = async (request: HttpRequest) => {
		const body = JSON.parse(request.body ?? "{}") as {
			query: string;
			variables: Record<string, unknown>;
		};
		const operation = /query (\w+)/.exec(body.query)?.[1] ?? "";
		calls.push({ operation, variables: body.variables });
		const data =
			operation in answers
				? { data: answers[operation as Operation] }
				: { errors: [{ message: `The stand-in has no answer for ${operation}.` }] };
		return ok({ status: 200, headers: {}, body: JSON.stringify(data) });
	};
	return { calls };
}

const viewer = { viewer: { id: "user-1", name: "Ada", organization: { name: "Acme" } } };

const myIssues = (nodes: unknown[]) => ({ viewer: { id: "user-1", assignedIssues: { nodes } } });

const shellOutput = (stdout = "", exitCode = 0): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr: "" });

/** Answers the git commands a branch rename runs: the checked-out branch, free names, the rename. */
function scriptBranchRename(test: TestContainer, checkedOut: string): ShellCommand[] {
	const renames: ShellCommand[] = [];
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "git") return null;
		const args = command.args.join(" ");
		if (args.includes("branch --show-current")) return shellOutput(`${checkedOut}\n`);
		if (args.includes("show-ref --verify")) return shellOutput("", 1);
		if (args.includes("remote get-url")) return shellOutput("", 2);
		if (args.includes("branch -m")) {
			renames.push(command);
			return shellOutput();
		}
		return null;
	});
	return renames;
}

async function setup(options: { linearKey?: boolean; remoteUrl?: string | null } = {}) {
	const test = createTestContainer();
	current = test;
	await test.container.services.settings.start();
	if (options.linearKey === true) {
		must(await test.memory.platform.keychain.set(LINEAR_API_KEY_KEYCHAIN_KEY, "lin_api_test"));
	}
	const repo = await seedRepo(test.container, { remoteUrl: options.remoteUrl ?? null });
	// The workspace screen loads the project's settings; a rename and a GitHub read need its remote.
	must(await test.container.services.repo.loadConfig(repo.id));
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	test.container.services.sessions.store.setState((state) => ({
		...state,
		viewingSessionId: session.id,
	}));
	const rootRoute = createRootRoute();
	const chat = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <Composer workspaceId={workspace.id} sessionId={session.id} />,
	});
	const settings = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings/$page",
		component: function SettingsPage() {
			return <p>{`settings page ${settings.useParams().page}`}</p>;
		},
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([chat, settings]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<CommandDispatcher>
					<RouterProvider router={router} />
				</CommandDispatcher>
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	await screen.findByLabelText("composer");
	return { test, workspace, session };
}

const pressCmdI = () => {
	act(() => {
		fireEvent.keyDown(document.body, { key: "i", metaKey: true });
	});
};

const searchBox = () => screen.findByPlaceholderText("Search issues...");

const attachmentNames = (): string[] => {
	const list = screen.queryByRole("list", { name: "Attachments" });
	if (list === null) return [];
	return within(list)
		.queryAllByRole("listitem")
		.map((item) => item.textContent ?? "");
};

describe("PR-09 Link issue dialog: opening it", () => {
	it("opens on Cmd+I and closes on a second Cmd+I", async () => {
		await setup();
		pressCmdI();
		expect(await searchBox()).toBeTruthy();
		pressCmdI();
		await waitFor(() => expect(screen.queryByPlaceholderText("Search issues...")).toBeNull());
	});

	it("gives the editor focus again when Escape closes it", async () => {
		await setup();
		pressCmdI();
		fireEvent.keyDown(await searchBox(), { key: "Escape" });
		await waitFor(() => expect(screen.queryByPlaceholderText("Search issues...")).toBeNull());
		await waitFor(() =>
			expect(screen.getByLabelText("composer").contains(document.activeElement)).toBe(true),
		);
	});

	it("gives the editor focus after a choice, even when its own focus lands first", async () => {
		const { test } = await setup({ linearKey: true });
		linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue({ branchName: null }) },
		});
		// The editor asks for focus in an animation frame. Run that at once, so the dialog's own
		// close focus (a timer) comes after it, as it can when the main thread is busy.
		vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
			callback(0);
			return 0;
		});
		pressCmdI();
		fireEvent.click(await screen.findByRole("option", { name: /ENG-12/ }));
		await waitFor(() => expect(attachmentNames()).toEqual(["[LINEAR]-ENG-12.md"]));
		await waitFor(() =>
			expect(screen.getByLabelText("composer").contains(document.activeElement)).toBe(true),
		);
	});

	it("opens from the '+' menu's Link issue", async () => {
		await setup();
		const trigger = screen.getByRole("button", { name: "Add attachments, link issues, and more" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: /Link issue/ }));
		expect(await searchBox()).toBeTruthy();
	});

	it("offers Connect Linear without a key, and it opens the Account settings", async () => {
		await setup();
		pressCmdI();
		const connect = await screen.findByRole("option", { name: /Connect Linear/ });
		expect(within(connect).getByText("Setup")).toBeTruthy();
		fireEvent.click(connect);
		expect(await screen.findByText("settings page account")).toBeTruthy();
		expect(screen.queryByPlaceholderText("Search issues...")).toBeNull();
	});
});

describe("PR-09 Link issue dialog: Linear", () => {
	it("lists my active issues and links the chosen one to the chat's draft", async () => {
		const { test, session } = await setup({ linearKey: true });
		linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue({ branchName: null }) },
		});
		pressCmdI();

		expect(await screen.findByText("Recent issues")).toBeTruthy();
		const row = await screen.findByRole("option", { name: /ENG-12/ });
		expect(within(row).getByText("The list loses its place")).toBeTruthy();
		fireEvent.click(row);

		await waitFor(() => expect(attachmentNames()).toEqual(["[LINEAR]-ENG-12.md"]));
		expect(screen.queryByPlaceholderText("Search issues...")).toBeNull();
		await waitFor(() =>
			expect(screen.getByLabelText("composer").contains(document.activeElement)).toBe(true),
		);
		const draft = test.container.services.composer.draftOf(session.id);
		expect(draft.attachmentPaths).toHaveLength(1);
		const staged = draft.attachmentPaths[0] ?? "";
		expect(staged.endsWith("/[LINEAR]-ENG-12.md")).toBe(true);
		expect(test.memory.controls.files.get(staged)).toContain("# ENG-12: The list loses its place");
	});

	it("unlinks the issue when its chip is removed", async () => {
		const { test, session } = await setup({ linearKey: true });
		linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue({ branchName: null }) },
		});
		pressCmdI();
		fireEvent.click(await screen.findByRole("option", { name: /ENG-12/ }));
		await waitFor(() => expect(attachmentNames()).toEqual(["[LINEAR]-ENG-12.md"]));
		const staged = test.container.services.composer.draftOf(session.id).attachmentPaths[0] ?? "";

		fireEvent.click(screen.getByRole("button", { name: "Remove [LINEAR]-ENG-12.md" }));

		await waitFor(() => expect(attachmentNames()).toEqual([]));
		expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([]);
		expect(test.memory.controls.files.has(staged)).toBe(false);
	});

	it("renames a placeholder branch to the branch Linear suggests", async () => {
		const { test, workspace } = await setup({ linearKey: true });
		linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue() },
		});
		const renames = scriptBranchRename(test, workspace.branch);
		const success = vi.spyOn(toast, "success").mockReturnValue("toast-id");
		pressCmdI();
		fireEvent.click(await screen.findByRole("option", { name: /ENG-12/ }));

		await waitFor(() =>
			expect(success).toHaveBeenCalledWith("Branch renamed to eng-12-list-place"),
		);
		expect(renames.map((command) => command.args.join(" "))).toEqual([
			expect.stringContaining(`branch -m -- ${workspace.branch} eng-12-list-place`),
		]);
		const saved = test.container.services.workspace.store.getState().workspacesById[workspace.id];
		expect(saved?.branch).toBe("eng-12-list-place");
		expect(saved?.branchIsPlaceholder).toBe(false);
	});

	it("leaves a branch the user already named alone", async () => {
		const test = createTestContainer();
		current = test;
		const { test: mounted } = await setupWithNamedBranch(test);
		linearStandIn(mounted, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue() },
		});
		const renames = scriptBranchRename(mounted, "my-own-branch");
		pressCmdI();
		fireEvent.click(await screen.findByRole("option", { name: /ENG-12/ }));
		await waitFor(() => expect(attachmentNames()).toEqual(["[LINEAR]-ENG-12.md"]));
		expect(renames).toEqual([]);
	});

	it("searches after the typing stops, and says when nothing matches", async () => {
		const { test } = await setup({ linearKey: true });
		const linear = linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([]),
			GetUserTeamIds: {
				viewer: { teams: { nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }] } },
			},
			SearchIssuesWithTeamFilter: { searchIssues: { nodes: [] } },
		});
		pressCmdI();
		expect(await screen.findByText("No open issues found")).toBeTruthy();

		fireEvent.change(await searchBox(), { target: { value: "nothing like this" } });

		expect(await screen.findByText("No issues found")).toBeTruthy();
		const searches = linear.calls.filter((call) => call.operation === "SearchIssuesWithTeamFilter");
		expect(searches.map((call) => call.variables.term)).toEqual(["nothing like this"]);
	});

	it("shows why Linear's list failed, before the key was ever checked", async () => {
		const { test } = await setup({ linearKey: true });
		linearStandIn(test, {});
		pressCmdI();
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Linear could not answer: The stand-in has no answer for MyActiveIssues..",
		);
	});

	it("links an issue once when it is chosen twice in a row", async () => {
		const { test, session } = await setup({ linearKey: true });
		const linear = linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: linearIssue({ branchName: null }) },
		});
		pressCmdI();
		const row = await screen.findByRole("option", { name: /ENG-12/ });
		fireEvent.click(row);
		fireEvent.click(row);
		await waitFor(() => expect(attachmentNames()).toEqual(["[LINEAR]-ENG-12.md"]));
		const reads = linear.calls.filter((call) => call.operation === "GetIssueById");
		expect(reads).toHaveLength(1);
		const staged = must(
			await test.container.services.composer.loadDraft(session.id),
		).attachmentPaths;
		expect(staged).toHaveLength(1);
	});

	it("reports an issue that could not be read and links nothing", async () => {
		const { test } = await setup({ linearKey: true });
		linearStandIn(test, {
			Viewer: viewer,
			MyActiveIssues: myIssues([linearIssue()]),
			GetIssueById: { issue: null },
		});
		const failed = vi.spyOn(toast, "error").mockReturnValue("toast-id");
		pressCmdI();
		fireEvent.click(await screen.findByRole("option", { name: /ENG-12/ }));
		await waitFor(() =>
			expect(failed).toHaveBeenCalledWith(
				"Failed to link Linear issue: Linear has no issue with that identifier.",
			),
		);
		expect(attachmentNames()).toEqual([]);
	});
});

describe("PR-09 Link issue dialog: GitHub", () => {
	const remoteUrl = "https://github.com/octo/repo.git";
	const githubIssue = {
		number: 7,
		title: "Search drops the last letter",
		html_url: "https://github.com/octo/repo/issues/7",
		state: "open",
		updated_at: "2026-11-05T10:00:00Z",
		body: "Typing fast loses a letter.",
	};

	it("lists the repository's GitHub issues beside Linear's and links one", async () => {
		const { test, session } = await setup({ remoteUrl });
		test.container.services.github.store.setState((state) => ({
			...state,
			access: {
				status: "ok",
				login: "octo",
				host: "github.com",
				scopes: ["repo"],
				usesToken: false,
				gitProtocol: "https",
			},
		}));
		test.memory.controls.scriptShell((command) => {
			const args = command.args.join(" ");
			if (command.program === "git" && args.includes("remote get-url")) {
				return shellOutput(`${remoteUrl}\n`);
			}
			if (args.includes("repos/octo/repo/issues?"))
				return shellOutput(JSON.stringify([githubIssue]));
			if (args.includes("repos/octo/repo/issues/7"))
				return shellOutput(JSON.stringify(githubIssue));
			return null;
		});
		pressCmdI();

		const row = await screen.findByRole("option", { name: /#7/ });
		expect(within(row).getByText("Search drops the last letter")).toBeTruthy();
		fireEvent.click(row);

		await waitFor(() => expect(attachmentNames()).toEqual(["[GITHUB]-7.md"]));
		const staged = test.container.services.composer.draftOf(session.id).attachmentPaths[0] ?? "";
		expect(test.memory.controls.files.get(staged)).toContain("Typing fast loses a letter.");
	});

	it("tells a signed-out user to run gh auth login, and Dismiss closes the dialog", async () => {
		const { test } = await setup({ remoteUrl });
		test.container.services.github.store.setState((state) => ({
			...state,
			access: { status: "signed_out" },
		}));
		pressCmdI();
		const setupRow = await screen.findByRole("option", {
			name: /Run "gh auth login" to connect GitHub/,
		});
		expect(within(setupRow).getByText("Dismiss")).toBeTruthy();
		fireEvent.click(setupRow);
		await waitFor(() => expect(screen.queryByPlaceholderText("Search issues...")).toBeNull());
	});
});

/** Mounts the composer over a workspace whose branch the user already named. */
async function setupWithNamedBranch(test: TestContainer) {
	await test.container.services.settings.start();
	must(await test.memory.platform.keychain.set(LINEAR_API_KEY_KEYCHAIN_KEY, "lin_api_test"));
	const workspace = await seedWorkspace(test.container, {
		branch: "my-own-branch",
		branchIsPlaceholder: false,
	});
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	test.container.services.sessions.store.setState((state) => ({
		...state,
		viewingSessionId: session.id,
	}));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<CommandDispatcher>
					<Composer workspaceId={workspace.id} sessionId={session.id} />
				</CommandDispatcher>
			</AppProviders>
		</ServicesProvider>,
	);
	await screen.findByLabelText("composer");
	return { test, workspace, session };
}
