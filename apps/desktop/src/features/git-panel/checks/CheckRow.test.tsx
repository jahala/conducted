import { ok, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { CheckRun, PullRequest } from "../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { CheckRow } from "./CheckRow.tsx";

const workspaceId = "w1" as WorkspaceId;

const failed: CheckRun = {
	name: "Build",
	state: "failure",
	url: null,
	startedAt: 1_000,
	completedAt: 61_000,
	required: true,
};

const pullRequest: PullRequest = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the checks tab",
	body: "",
	state: "open",
	mergeable: "unknown",
	reviewDecision: null,
	checks: [failed],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
};

let test: TestContainer;

function Harness({ check }: { check: CheckRun }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<CheckRow
			workspaceId={workspaceId}
			check={check}
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
		/>
	);
}

function renderRow(check: CheckRun = failed) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<ServicesProvider container={test.container}>
			<QueryClientProvider client={client}>
				<Harness check={check} />
			</QueryClientProvider>
		</ServicesProvider>,
	);
}

beforeEach(() => {
	test = createTestContainer();
	test.container.services.github.store.setState((state) => ({
		...state,
		byWorkspace: {
			[workspaceId]: { pullRequest, unavailable: "none", fetchedAt: 1 },
		},
	}));
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("PR-04 check row", () => {
	it("loads the log once on first expand and does not load it again after a collapse", async () => {
		const read = vi
			.spyOn(test.container.services.github, "readCheckLog")
			.mockResolvedValue(ok("a log line"));
		renderRow();
		expect(read).not.toHaveBeenCalled();

		const toggle = screen.getByRole("button", { name: /Build/ });
		fireEvent.click(toggle);
		await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
		// The query renders its answer after the read resolves, a tick after the call itself.
		expect(await screen.findByText("a log line")).toBeTruthy();

		fireEvent.click(toggle);
		fireEvent.click(toggle);
		expect(read).toHaveBeenCalledTimes(1);
		expect(screen.getByText("a log line")).toBeTruthy();
	});

	it("shows the name, state and duration of a finished check", () => {
		renderRow();
		expect(screen.getByText("Build")).toBeTruthy();
		expect(screen.getByText("Failed")).toBeTruthy();
		expect(screen.getByText("1m 0s")).toBeTruthy();
	});
});
