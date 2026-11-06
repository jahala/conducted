/**
 * @feature PR-08 Stack view in the Changes tab
 * Owns: the container test that the Changes tab shows the stack from `useStack`, hides it while
 * stacked pull requests are off, names the trunk without cutting a slash out of it, reaches switch
 * branch, marks the clicked draft ready, not the workspace's own pull request, turns clicks on
 * stack entries into the range scope, and lists a range's files through the real git service.
 * Behaviour: ui-map.md 3.6, 6 Git ("Use GitHub stacked PRs" enables the stack view);
 * services-map.md 3.4.1 (view mode `range`) and 3.4.5.
 * Test first: the Changes tab draws the stack's three entries over the real container.
 */
import { ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../../app/providers.tsx";
import type { DiffScope } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { ShellCommand, ShellOutput } from "../../../platform/platform.ts";
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
				number: 11,
				stackEntry: { position: 1, stack: { number: 5, size: 3, baseRefName: "main" } },
			},
		},
	},
});

/** Each branch's head commit on GitHub. */
const SHA: Record<string, string> = {
	main: "0".repeat(40),
	"feat-a": "a".repeat(40),
	"feat-b": "b".repeat(40),
	"feat-c": "c".repeat(40),
};

const member = (number: number, title: string, draft: boolean, ref: string, base: string) => ({
	number,
	title,
	state: "OPEN",
	draft,
	head: { ref, sha: SHA[ref] },
	base: { ref: base, sha: SHA[base] },
});

const membersAnswer = JSON.stringify({
	pull_requests: [
		member(10, "Add the parser", false, "feat-a", "main"),
		member(11, "Use the parser", false, "feat-b", "feat-a"),
		member(12, "Document it", true, "feat-c", "feat-b"),
	],
});

async function seedDashboard(
	enabled: boolean,
	targetBranch?: string,
	gitAnswer?: (command: ShellCommand) => Result<ShellOutput> | null,
): Promise<{
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
		...(targetBranch === undefined ? {} : { targetBranch }),
	});
	// The workspace's own pull request is #11, the current entry; the draft is #12 above it.
	await seedPullRequest(test.container, workspace.id, {
		number: 11,
		title: "Use the parser",
		description: null,
	});
	await test.container.services.workspace.start();
	const setting = await test.container.actions.settings.set("github_stacked_prs_enabled", enabled);
	if (!setting.ok) throw new Error(setting.error.message);

	test.memory.controls.scriptShell((command) => {
		const answer = gitAnswer?.(command);
		if (answer !== null && answer !== undefined) return answer;
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

function renderTab(
	harness: TestContainer,
	workspaceId: string,
	scope: DiffScope = { kind: "branch" },
	onScopeChange: (scope: DiffScope) => void = vi.fn(),
): void {
	render(
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<ChangesTab
					graphiteStack={{ isInStack: false, branches: [] }}
					workspaceId={workspaceId as never}
					scope={scope}
					onScopeChange={onScopeChange}
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
		const markReady = vi.spyOn(harness.container.services.github, "markReady");

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

		// The only draft is #12, which is not the workspace's own pull request (#11).
		fireEvent.click(screen.getByRole("button", { name: "Ready for review" }));
		await waitFor(() => expect(markReady).toHaveBeenCalledWith(workspaceId, 12));
		const ready = () =>
			harness.memory.controls.shellCalls
				.filter((command) => command.program === "gh" && command.args[1] === "ready")
				.map((command) => command.args);
		await waitFor(() => expect(ready()).toEqual([["pr", "ready", "12"]]));
	});

	it("names a trunk with a slash in full", async () => {
		const { harness, workspaceId } = await seedDashboard(true, "release/1.0");

		renderTab(harness, workspaceId);

		await waitFor(() => expect(screen.getByText("Stack PRs")).toBeTruthy());
		expect(screen.getByTestId("stack-trunk").textContent).toBe("release/1.0(trunk)");
	});

	it("hides the stack while stacked pull requests are off", async () => {
		const { harness, workspaceId } = await seedDashboard(false);

		renderTab(harness, workspaceId);

		await waitFor(() => expect(screen.queryByText("Stack PRs")).toBeNull());
	});

	it("turns clicks on stack entries into the range scope", async () => {
		const { harness, workspaceId } = await seedDashboard(true);
		const onScopeChange = vi.fn();

		renderTab(harness, workspaceId, { kind: "branch" }, onScopeChange);

		const first = await screen.findByRole("button", { name: "#10 Add the parser" });
		fireEvent.click(first);
		expect(onScopeChange).toHaveBeenLastCalledWith({ kind: "range", prNumbers: [10] });
		// Shift-click from #10 chooses the block up to #12.
		fireEvent.click(screen.getByRole("button", { name: "#12 Document it" }), { shiftKey: true });
		expect(onScopeChange).toHaveBeenLastCalledWith({ kind: "range", prNumbers: [10, 11, 12] });
		// Only the checked-out pull request is the branch's own changes.
		fireEvent.click(screen.getByRole("button", { name: "#11 Use the parser" }));
		expect(onScopeChange).toHaveBeenLastCalledWith({ kind: "branch" });
	});

	it("lists the files of a pull request's range through the real git service", async () => {
		const fromOid = "1".repeat(40);
		const { harness, workspaceId } = await seedDashboard(true, undefined, (command) => {
			if (command.program !== "git") return null;
			// Every pull request of the stack is resolved; #10's range starts at fromOid.
			if (command.args.includes("merge-base")) {
				return output(command.args.includes(SHA.main as string) ? `${fromOid}\n` : "9".repeat(40));
			}
			if (command.args.includes("diff") && command.args.includes("--name-status")) {
				return output("M\tsrc/range.ts\n");
			}
			if (command.args.includes("diff") && command.args.includes("--numstat")) {
				return output("3\t1\tsrc/range.ts\n");
			}
			return null;
		});

		renderTab(harness, workspaceId, { kind: "range", prNumbers: [10] });

		expect(await screen.findByText(/range\.ts/)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "#10 Add the parser" }).getAttribute("aria-pressed"),
		).toBe("true");
		const diff = harness.memory.controls.shellCalls.find(
			(command) => command.args.includes("diff") && command.args.includes("--name-status"),
		);
		// #10 runs from the merge base of main and its head to its head on GitHub.
		expect(diff?.args.slice(-2)).toEqual([fromOid, SHA["feat-a"]]);
	});

	it("says when the chosen pull requests are not next to each other", async () => {
		const { harness, workspaceId } = await seedDashboard(true, undefined, (command) =>
			command.program === "git" && command.args.includes("merge-base")
				? output(`${"1".repeat(40)}\n`)
				: null,
		);

		renderTab(harness, workspaceId, { kind: "range", prNumbers: [10, 12] });

		expect(await screen.findByText("Select adjacent PRs to see their changes")).toBeTruthy();
	});

	it("says when the chosen pull requests change nothing", async () => {
		const { harness, workspaceId } = await seedDashboard(true, undefined, (command) =>
			command.program === "git" && command.args.includes("merge-base")
				? output(`${"1".repeat(40)}\n`)
				: null,
		);

		renderTab(harness, workspaceId, { kind: "range", prNumbers: [10] });

		expect(await screen.findByText("No changes in the selected PRs")).toBeTruthy();
	});

	it("names the pull request whose commits are not in the workspace", async () => {
		const { harness, workspaceId } = await seedDashboard(true, undefined, (command) => {
			if (command.program !== "git") return null;
			if (command.args.includes("rev-parse") && command.args.includes(`${SHA["feat-c"]}^0`)) {
				return output("", "", 1);
			}
			if (command.args.includes("fetch")) {
				return output("", "fatal: couldn't find remote ref feat-c", 128);
			}
			if (command.args.includes("merge-base")) return output(`${"1".repeat(40)}\n`);
			return null;
		});

		renderTab(harness, workspaceId, { kind: "range", prNumbers: [12] });

		expect(await screen.findByText("Can't show #12's changes")).toBeTruthy();
		expect(screen.getByText("Its commits aren't in this workspace")).toBeTruthy();
		const fetches = harness.memory.controls.shellCalls.filter((command) =>
			command.args.includes("fetch"),
		);
		expect(fetches.at(0)?.args.slice(-2)).toEqual(["origin", "feat-c"]);
	});
});
