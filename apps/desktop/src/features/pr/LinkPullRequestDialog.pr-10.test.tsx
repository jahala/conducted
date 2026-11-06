/**
 * @feature PR-10 Link a pull request by URL or number
 * Owns: tests for the "Link pull request" dialog itself, and for reaching it from the PR tab
 * through the `pr.link` command over the real container.
 * Behaviour: ui-map.md 3.10 and 5.2 ("Link pull request", "PR URL or number").
 * Test first: typing a pull request URL and pressing Link calls onSubmit with that URL once.
 */
import { ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { LinkPullRequestDialog } from "./LinkPullRequestDialog.tsx";

vi.mock("../workspace/WorkspaceHeader.tsx", () => ({
	WorkspaceHeader: () => <p>header region</p>,
}));
vi.mock("../workspace/SplitPanes.tsx", () => ({
	SplitPanes: () => <p>tabs and content region</p>,
}));
vi.mock("../git-panel/GitPanel.tsx", () => ({
	GitPanel: () => <p>git panel region</p>,
}));
vi.mock("../scripts-panel/ScriptsPanel.tsx", () => ({
	ScriptsPanel: () => <p>scripts panel region</p>,
}));
vi.mock("../workspace/WorkspaceGate.tsx", () => ({
	WorkspaceGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { WorkspaceScreen } = await import("../workspace/WorkspaceScreen.tsx");

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

const remoteUrl = "https://github.com/octo/repo.git";
const prJson = JSON.stringify({
	number: 123,
	title: "Link me",
	html_url: "https://github.com/octo/repo/pull/123",
	state: "open",
	draft: false,
	merged_at: null,
	updated_at: "2026-11-05T09:00:00Z",
	body: "",
	user: { login: "ada" },
	head: { ref: "feature/link" },
});

function renderDialog(onSubmit: (text: string) => Promise<Result<unknown>>) {
	render(<LinkPullRequestDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
}

describe("PR-10 Link pull request dialog", () => {
	it("submits the typed pull request URL once", async () => {
		const submitted: string[] = [];
		renderDialog(async (text) => {
			submitted.push(text);
			return ok(undefined);
		});

		fireEvent.change(screen.getByLabelText("PR URL or number"), {
			target: { value: " https://github.com/octo/repo/pull/123 " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Link" }));

		await waitFor(() => expect(submitted).toEqual(["https://github.com/octo/repo/pull/123"]));
	});

	it("keeps the dialog open with the error when the link is refused", async () => {
		renderDialog(async () => ({
			ok: false as const,
			error: {
				code: "github_pr_invalid",
				message: "Enter a pull request number or a GitHub pull request URL.",
			},
		}));

		fireEvent.change(screen.getByLabelText("PR URL or number"), {
			target: { value: "nope" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Link" }));

		expect(
			await screen.findByText("Enter a pull request number or a GitHub pull request URL."),
		).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("disables Link while the field is empty", () => {
		renderDialog(async () => ok(undefined));

		const link = screen.getByRole("button", { name: "Link" }) as HTMLButtonElement;
		expect(link.disabled).toBe(true);
	});
});

describe("PR-10 link from the workspace screen through the container", () => {
	it("opens from the pr.link command and stores the linked pull request", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, {
				rootPath: "/code/projects/pr-10-dialog",
				remoteUrl,
			});
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/pr-10-dialog",
				branch: "feature/link",
			});
			harness.memory.controls.scriptShell((command) => {
				if (command.program === "git" && command.args.includes("get-url")) {
					return ok({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" });
				}
				if (
					command.program === "gh" &&
					command.args[0] === "api" &&
					command.args[1]?.endsWith("/pulls/123") === true
				) {
					return ok({ exitCode: 0, stdout: prJson, stderr: "" });
				}
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});

			const rootRoute = createRootRoute();
			const route = createRoute({
				getParentRoute: () => rootRoute,
				path: "/",
				component: () => (
					<WorkspaceScreen
						repoId={repo.id as RepoId}
						workspaceId={workspace.id as WorkspaceId}
						search={{}}
						onSearchChange={() => {}}
					/>
				),
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

			expect(runCommandHandlers("pr.link")).toBe(true);
			fireEvent.change(await screen.findByLabelText("PR URL or number"), {
				target: { value: "https://github.com/octo/repo/pull/123" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Link" }));

			await waitFor(() => {
				const stored =
					harness.container.services.workspace.store.getState().workspacesById[workspace.id];
				expect(stored?.prNumber).toBe(123);
			});
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
