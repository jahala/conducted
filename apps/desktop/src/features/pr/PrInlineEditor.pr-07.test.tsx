/**
 * @feature PR-07 Inline PR title and description editor
 * Owns: tests over the real container and the git panel's Checks tab: the pull request's title
 * and description sit at the top of the tab as fields, Save and Discard show once either changes,
 * Save sends both with one edit, Discard puts the pull request's text back, an empty title cannot
 * be saved, a failed save says why and keeps the typing, and a change on GitHub replaces the
 * fields only while they hold no unsaved edit.
 * Behaviour: ui-map.md 3.6 ("PR title and description are editable inline": "PR title", "PR
 * description", Save, Discard).
 * Test first: changing the description and pressing Save calls updateTitleAndBody once with the
 * title and the new description.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { PullRequest } from "../../core/model.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { ChecksTab } from "../git-panel/checks/ChecksTab.tsx";

let opened: TestContainer | null = null;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	opened?.close();
	opened = null;
});

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the importer",
	body: "Reads CSV files.",
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

function showPullRequest(test: TestContainer, workspaceId: WorkspaceId, pr: PullRequest): void {
	act(() => {
		test.container.services.github.store.setState((state) => ({
			...state,
			byWorkspace: {
				...state.byWorkspace,
				[workspaceId]: { pullRequest: pr, unavailable: "none", fetchedAt: 1 },
			},
		}));
	});
}

async function mount(pr: PullRequest = pullRequest()) {
	const test = createTestContainer();
	opened = test;
	const workspace = await seedWorkspace(test.container);
	test.container.services.git.store.setState((state) => ({
		...state,
		byWorkspace: {
			...state.byWorkspace,
			[workspace.id]: {
				snapshot: {
					depth: "full",
					branch: "feat/importer",
					mergeBase: null,
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
	}));
	test.container.services.review.store.setState((state) => ({
		...state,
		byWorkspace: { ...state.byWorkspace, [workspace.id]: [] },
	}));
	showPullRequest(test, workspace.id, pr);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<ServicesProvider container={test.container}>
			<QueryClientProvider client={client}>
				<ChecksTab workspaceId={workspace.id} />
				<Toaster />
			</QueryClientProvider>
		</ServicesProvider>,
	);
	return { test, workspaceId: workspace.id };
}

const titleField = () => screen.getByRole("textbox", { name: "PR title" }) as HTMLInputElement;
const descriptionField = () =>
	screen.getByRole("textbox", { name: "PR description" }) as HTMLTextAreaElement;
const saveButton = () => screen.queryByRole("button", { name: "Save" }) as HTMLButtonElement | null;

describe("PR-07 inline PR title and description in the Checks tab", () => {
	it("shows the title and description as fields, with no Save until one changes", async () => {
		await mount();

		expect((await screen.findByRole("textbox", { name: "PR title" })).getAttribute("value")).toBe(
			"Add the importer",
		);
		expect(descriptionField().value).toBe("Reads CSV files.");
		expect(titleField().placeholder).toBe("PR title");
		expect(descriptionField().placeholder).toBe("PR description");
		expect(saveButton()).toBeNull();
		expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
	});

	it("saves the title and the new description with one edit", async () => {
		const { test, workspaceId } = await mount();
		const update = vi
			.spyOn(test.container.actions.pullRequests, "updateTitleAndBody")
			.mockResolvedValue(ok(undefined));

		fireEvent.change(await screen.findByRole("textbox", { name: "PR description" }), {
			target: { value: "Reads CSV and TSV files." },
		});
		fireEvent.click(saveButton() as HTMLButtonElement);

		await waitFor(() => expect(saveButton()).toBeNull());
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith(
			workspaceId,
			"Add the importer",
			"Reads CSV and TSV files.",
		);
		expect(descriptionField().value).toBe("Reads CSV and TSV files.");
	});

	it("puts the pull request's text back on Discard", async () => {
		const { test } = await mount();
		const update = vi.spyOn(test.container.actions.pullRequests, "updateTitleAndBody");

		fireEvent.change(await screen.findByRole("textbox", { name: "PR title" }), {
			target: { value: "A new title" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		expect(titleField().value).toBe("Add the importer");
		expect(saveButton()).toBeNull();
		expect(update).not.toHaveBeenCalled();
	});

	it("does not save an empty title", async () => {
		const { test } = await mount();
		const update = vi.spyOn(test.container.actions.pullRequests, "updateTitleAndBody");

		fireEvent.change(await screen.findByRole("textbox", { name: "PR title" }), {
			target: { value: "   " },
		});

		expect(saveButton()?.disabled).toBe(true);
		fireEvent.click(saveButton() as HTMLButtonElement);
		expect(update).not.toHaveBeenCalled();
	});

	it("says why a save failed and keeps the typing with Save offered again", async () => {
		const { test } = await mount();
		let answer: (result: Result<void>) => void = () => {};
		vi.spyOn(test.container.actions.pullRequests, "updateTitleAndBody").mockImplementation(
			() =>
				new Promise((resolve) => {
					answer = resolve;
				}),
		);

		fireEvent.change(await screen.findByRole("textbox", { name: "PR title" }), {
			target: { value: "A new title" },
		});
		fireEvent.click(saveButton() as HTMLButtonElement);
		expect(titleField().readOnly).toBe(true);
		await act(async () => {
			answer(err(appError("github_failed", "GraphQL: Resource not accessible")));
		});

		expect(
			await screen.findByText("Failed to update PR on GitHub: GraphQL: Resource not accessible"),
		).toBeTruthy();
		expect(titleField().value).toBe("A new title");
		expect(titleField().readOnly).toBe(false);
		expect(saveButton()?.disabled).toBe(false);
	});

	it("takes a change made on GitHub unless the field holds an unsaved edit", async () => {
		const { test, workspaceId } = await mount();
		fireEvent.change(await screen.findByRole("textbox", { name: "PR description" }), {
			target: { value: "My unsaved words" },
		});

		showPullRequest(
			test,
			workspaceId,
			pullRequest({ title: "Renamed on GitHub", body: "Rewritten on GitHub" }),
		);

		expect(titleField().value).toBe("Renamed on GitHub");
		expect(descriptionField().value).toBe("My unsaved words");
	});
});
