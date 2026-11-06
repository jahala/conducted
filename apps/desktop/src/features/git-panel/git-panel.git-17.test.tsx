/**
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * Owns: the Git panel's Continue header: a merged pull request and a detached HEAD both offer
 * Continue, the button reaches `git.continueOnNewBranch`, and a note failure shows the Conductor
 * message.
 * Behaviour: inventory-ui-text.md "Continue after merge"; services-map.md 3.1; inventory:toast row
 * 578 ("Failed to attach continue context").
 * Test first: a merged pull request shows a Continue button, and clicking it continues on a new
 * branch with no typed name.
 */
import { appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { PullRequest, Workspace } from "../../core/model.ts";
import { CONTINUE_NOTE_FAILED_MESSAGE } from "../../core/services/git.ts";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { GitPanel } from "./GitPanel.tsx";

let test: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	if (test !== null) {
		await test.container.stop();
		test.close();
	}
	test = null;
});

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: null,
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: true,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
	...overrides,
});

/** A workspace with the given branch, git snapshot and pull request in the stores. */
async function seedPanel(options: {
	branch: string;
	pullRequest: PullRequest | null;
}): Promise<{ test: TestContainer; workspace: Workspace }> {
	test = createTestContainer();
	const repo = await seedRepo(test.container);
	// Continue reads the repository's remote name from its loaded config.
	const loaded = await test.container.services.repo.loadConfig(repo.id);
	if (!loaded.ok) throw new Error(loaded.error.message);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		branch: options.branch === "" ? "feat" : options.branch,
	});
	test.container.services.git.store.setState({
		byWorkspace: {
			[workspace.id]: {
				snapshot: {
					depth: "full",
					branch: options.branch,
					mergeBase: "abc123",
					mergeBaseError: null,
					files: [],
					conflictedPaths: [],
					untrackedTruncated: false,
					uncommittedFiles: 0,
					changedFiles: 0,
					operation: "none",
					commits: [],
					sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
					behindTarget: 0,
				},
				error: null,
				refreshedAt: 1,
			},
		},
	});
	test.container.services.github.store.setState({
		byWorkspace: {
			[workspace.id]: {
				pullRequest: options.pullRequest,
				unavailable: "none",
				fetchedAt: 1,
			},
		},
	});
	return { test, workspace };
}

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

/** Answers the commands a Continue from branch "feat" runs, and counts its `checkout -b`. */
function scriptContinue(harness: TestContainer): { checkouts: () => number } {
	let checkouts = 0;
	harness.memory.controls.scriptShell((command) => {
		const args = argv(command);
		if (args[0] === "branch" && args[1] === "--show-current") return output("feat\n");
		if (args[0] === "fetch") return output();
		if (args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main") {
			return output("target-sha\n");
		}
		if (args[0] === "show-ref") {
			const ref = args[args.length - 1] ?? "";
			return ref.endsWith("/feat") ? output("sha refs/heads/feat\n") : output("", "", 1);
		}
		if (args[0] === "remote" && args[1] === "get-url") {
			return output("git@example.com:acme/app.git\n");
		}
		if (args[0] === "checkout" && args[1] === "-b") {
			checkouts += 1;
			return output();
		}
		return null;
	});
	return { checkouts: () => checkouts };
}

/**
 * Waits for the app's toast host to show an error toast with this title, and returns its
 * description. Other toasts, such as a failed git read, may show beside it.
 */
async function errorToastDescription(title: string): Promise<string> {
	return waitFor(() => {
		const shown = [...document.querySelectorAll("[data-sonner-toast][data-type='error']")].find(
			(element) => element.querySelector("[data-title]")?.textContent === title,
		);
		if (shown === undefined) throw new Error(`No error toast titled "${title}" is shown.`);
		return shown.querySelector("[data-description]")?.textContent ?? "";
	});
}

/** Mounts the panel under the providers the workspace screen uses. */
async function renderPanel(harness: TestContainer, workspace: Workspace): Promise<void> {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <GitPanel workspaceId={workspace.id} />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
}

describe("GIT-17 Continue header", () => {
	it("offers Continue after a merge and starts a branch with no typed name", async () => {
		const { test: harness, workspace } = await seedPanel({
			branch: "feat",
			pullRequest: pullRequest({ state: "merged" }),
		});
		const continueBranch = vi
			.spyOn(harness.container.services.git, "continueOnNewBranch")
			.mockResolvedValue(ok(undefined));
		vi.spyOn(harness.container.services.git, "refresh").mockResolvedValue(ok(undefined));
		await renderPanel(harness, workspace);

		fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));

		await waitFor(() => expect(continueBranch).toHaveBeenCalledWith(workspace.id, null));
	});

	it("offers Continue when HEAD is detached", async () => {
		const { test: harness, workspace } = await seedPanel({
			branch: "",
			pullRequest: null,
		});
		await renderPanel(harness, workspace);

		expect(await screen.findByRole("button", { name: /Continue/ })).toBeTruthy();
	});

	it("shows the attach message when the continuation note cannot be written", async () => {
		const { test: harness, workspace } = await seedPanel({
			branch: "feat",
			pullRequest: pullRequest({ state: "merged" }),
		});
		const failure = appError("continue_note_failed", CONTINUE_NOTE_FAILED_MESSAGE);
		vi.spyOn(harness.container.services.git, "continueOnNewBranch").mockResolvedValue({
			ok: false,
			error: failure,
		});
		await renderPanel(harness, workspace);

		fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));

		expect(await errorToastDescription(CONTINUE_NOTE_FAILED_MESSAGE)).toBe(failure.message);
	});

	it("stops offering Continue once the branch changed, even when the note failed", async () => {
		const { test: harness, workspace } = await seedPanel({
			branch: "feat",
			pullRequest: pullRequest({ state: "merged" }),
		});
		const shell = scriptContinue(harness);
		vi.spyOn(harness.container.services.sessions, "sendInstruction").mockResolvedValue(
			err(appError("chat_send_failed", "No chat could take the note.")),
		);
		await renderPanel(harness, workspace);

		fireEvent.click(await screen.findByRole("button", { name: /^Continue/ }));

		// GitPanel titles the toast with this message only for a `continue_note_failed` error.
		expect(await errorToastDescription(CONTINUE_NOTE_FAILED_MESSAGE)).toBe(
			CONTINUE_NOTE_FAILED_MESSAGE,
		);
		await waitFor(() => expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull());
		expect(
			harness.container.services.workspace.store.getState().workspacesById[workspace.id]?.branch,
		).toBe("feat-v2");
		expect(shell.checkouts()).toBe(1);
	});

	it("does not offer Continue again after a remount before GitHub is read again", async () => {
		const { test: harness, workspace } = await seedPanel({
			branch: "feat",
			pullRequest: pullRequest({ state: "merged" }),
		});
		const shell = scriptContinue(harness);
		vi.spyOn(harness.container.services.sessions, "sendInstruction").mockResolvedValue(
			ok("chat-git-17" as SessionId),
		);
		await renderPanel(harness, workspace);
		fireEvent.click(await screen.findByRole("button", { name: /^Continue/ }));
		await waitFor(() => expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull());

		cleanup();
		await renderPanel(harness, workspace);

		expect(await screen.findByRole("button", { name: "PR status details" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
		expect(
			harness.container.services.github.store.getState().byWorkspace[workspace.id]?.pullRequest
				?.state,
		).toBe("merged");
		expect(shell.checkouts()).toBe(1);
	});
});
