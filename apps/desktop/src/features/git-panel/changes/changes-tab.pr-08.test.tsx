/**
 * @feature PR-08 Stack view in the Changes tab
 * Owns: the container test that the Changes tab shows the stack from `useStack`, hides it while
 * stacked pull requests are off, and reaches switch branch and mark ready.
 * Behaviour: ui-map.md 3.6, 6 Git ("Use GitHub stacked PRs" enables the stack view).
 * Test first: the Changes tab draws the stack's three entries over the real container.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../../app/providers.tsx";
import { ServicesProvider } from "../../../core/context.tsx";
import {
	createTestContainer,
	seedPullRequest,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import { ChangesTab } from "./ChangesTab.tsx";

let test: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	if (test !== null) {
		await test.container.stop();
		test.close();
	}
	test = null;
});

const output = (stdout = "", stderr = "", exitCode = 0) => ok({ stdout, stderr, exitCode });

const stackAnswer = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				number: 12,
				stackEntry: { position: 2, stack: { number: 5, size: 3, baseRefName: "main" } },
			},
		},
	},
});

const membersAnswer = JSON.stringify({
	pull_requests: [
		{ number: 10, title: "Add the parser", state: "OPEN", draft: false, head: { ref: "feat-a" } },
		{ number: 11, title: "Use the parser", state: "OPEN", draft: false, head: { ref: "feat-b" } },
		{ number: 12, title: "Document it", state: "OPEN", draft: true, head: { ref: "feat-c" } },
	],
});

async function seedDashboard(enabled: boolean): Promise<{
	harness: TestContainer;
	workspaceId: string;
}> {
	test = createTestContainer();
	const repo = await seedRepo(test.container, {
		rootPath: "/code/projects/pr-08-changes",
		remoteUrl: "git@github.com:o/r.git",
	});
	const loaded = await test.container.services.repo.loadConfig(repo.id);
	if (!loaded.ok) throw new Error(loaded.error.message);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		path: "/code/workspaces/pr-08-changes",
		branch: "feat-b",
	});
	await seedPullRequest(test.container, workspace.id, {
		number: 12,
		title: "Use the parser",
		description: null,
	});
	await test.container.services.workspace.start();
	const setting = await test.container.actions.settings.set("github_stacked_prs_enabled", enabled);
	if (!setting.ok) throw new Error(setting.error.message);

	test.memory.controls.scriptShell((command) => {
		if (command.program === "git" && command.args.includes("get-url")) {
			return output("git@github.com:o/r.git\n");
		}
		if (command.program === "gh" && command.args.includes("graphql")) {
			return output(stackAnswer);
		}
		if (
			command.program === "gh" &&
			command.args[0] === "api" &&
			command.args[1]?.includes("/stacks/5") === true
		) {
			return output(membersAnswer);
		}
		if (command.program === "gt") return output("", "", 1);
		return output();
	});
	return { harness: test, workspaceId: workspace.id };
}

function renderTab(harness: TestContainer, workspaceId: string): void {
	render(
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<ChangesTab
					workspaceId={workspaceId as never}
					scope={{ kind: "branch" }}
					onScopeChange={vi.fn()}
					onOpenFile={vi.fn()}
				/>
			</AppProviders>
		</ServicesProvider>,
	);
}

describe("PR-08 Changes tab stack view", () => {
	it("shows the stack over the real container and reaches switch branch and mark ready", async () => {
		const { harness, workspaceId } = await seedDashboard(true);
		const switchBranch = vi
			.spyOn(harness.container.services.git, "switchBranch")
			.mockResolvedValue(ok(undefined));
		const markReady = vi
			.spyOn(harness.container.services.github, "markReady")
			.mockResolvedValue(ok(undefined));

		renderTab(harness, workspaceId);

		await waitFor(() => expect(screen.getByText("Stack PRs")).toBeTruthy());
		expect(screen.getByTestId("stack-trunk").textContent).toContain("main");
		const rows = screen.getAllByTestId("stack-entry");
		expect(rows).toHaveLength(3);
		expect(rows[1]?.dataset.current).toBe("true");

		fireEvent.click(
			screen.getAllByRole("button", { name: "Checkout this branch" })[0] as HTMLElement,
		);
		await waitFor(() => expect(switchBranch).toHaveBeenCalledWith(workspaceId, "feat-a"));

		fireEvent.click(screen.getByRole("button", { name: "Ready for review" }));
		await waitFor(() => expect(markReady).toHaveBeenCalledWith(workspaceId));
	});

	it("hides the stack while stacked pull requests are off", async () => {
		const { harness, workspaceId } = await seedDashboard(false);

		renderTab(harness, workspaceId);

		await waitFor(() => expect(screen.queryByText("Stack PRs")).toBeNull());
	});
});
