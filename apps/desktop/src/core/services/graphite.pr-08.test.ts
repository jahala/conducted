/**
 * @feature PR-08 Read-only Graphite stacks
 * Owns: tests for the state parser, the install probe (a failed probe is asked again), the poll and
 * its switch, reads that start no poll, the parent and restack answers, the newest-answer rule, and
 * the one checkout call.
 * Behaviour: services-map.md 3.8.1, 3.0.2, 3.0.5.
 * Test first: two branches of a parsed state keep their parent and restack flag.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { graphiteState } from "../git/gh-commands.ts";
import { type GraphiteBranch, type GraphiteStack, graphiteStackOf } from "../graphite.ts";
import { GRAPHITE_POLL_INTERVAL_MS, GraphiteService, parseGraphiteState } from "./graphite.ts";

const repo = "/code/repo";

const stateJson = JSON.stringify({
	main: { trunk: true, needs_restack: false, parents: [] },
	"feature/one": { trunk: false, needs_restack: false, parents: [{ ref: "main" }] },
	"feature/two": { trunk: false, needs_restack: true, parents: [{ ref: "feature/one" }] },
});

function makeService(
	handler: ConstructorParameters<typeof FakeGitRunner>[0],
	options: { disabled?: () => boolean; settingMissing?: boolean } = {},
): { service: GraphiteService; git: FakeGitRunner } {
	const git = new FakeGitRunner(handler);
	const service = new GraphiteService({
		git,
		...(options.settingMissing === true
			? {}
			: {
					setting: <T>(key: string): T =>
						(key === "graphite_disabled" ? (options.disabled?.() ?? false) : undefined) as T,
				}),
		now: () => 1_000,
	});
	return { service, git };
}

const defaultHandler = (command: { program: string; args: readonly string[] }) => {
	if (command.program === "gt" && command.args[0] === "--version") return gitOutput("gt 1.0.0");
	if (command.program === "gt" && command.args[0] === "state") return gitOutput(stateJson);
	return gitOutput();
};

afterEach(() => {
	vi.useRealTimers();
});

describe("PR-08 Graphite state", () => {
	it("parses two branches with their parent and restack flag", () => {
		const parsed = parseGraphiteState(stateJson);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.find((branch) => branch.name === "main")?.trunk).toBe(true);
		expect(parsed.value.find((branch) => branch.name === "feature/two")).toEqual({
			name: "feature/two",
			trunk: false,
			needsRestack: true,
			parentBranch: "feature/one",
		});
	});

	it("refuses invalid JSON and a branch name it cannot read", () => {
		expect(parseGraphiteState("not json").ok).toBe(false);
		expect(parseGraphiteState(JSON.stringify({ "bad branch": { trunk: false } })).ok).toBe(false);
	});

	it("keeps the thirty-second timeout on the state command", () => {
		expect(graphiteState().timeoutMs).toBe(30_000);
	});

	it("reads the parent and restack flag of a branch", async () => {
		const { service } = makeService(defaultHandler);
		await service.refresh(repo);

		expect(service.parentBranchOf(repo, "feature/two")).toBe("feature/one");
		expect(service.parentBranchOf(repo, "main")).toBeNull();
		expect(service.needsRestackOf(repo, "feature/two")).toBe(true);
		expect(service.needsRestackOf(repo, "feature/one")).toBe(false);
		expect(service.containsBranch(repo, "feature/one")).toBe(true);
	});

	it("gives no parent for a branch that sits right on the trunk", async () => {
		const { service } = makeService(defaultHandler);
		await service.refresh(repo);

		// The diff target of a branch on the trunk stays the remote target, as Conductor's does.
		expect(service.parentBranchOf(repo, "feature/one")).toBeNull();
	});

	it("writes only the newest answer when two reads overlap", async () => {
		let stateCalls = 0;
		let releaseFirst: (() => void) | undefined;
		let startedFirst: (() => void) | undefined;
		const firstAnswer = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const firstStarted = new Promise<void>((resolve) => {
			startedFirst = resolve;
		});
		const { service } = makeService(async (command) => {
			if (command.program === "gt" && command.args[0] === "--version") return gitOutput("gt 1.0.0");
			if (command.program === "gt" && command.args[0] === "state") {
				stateCalls += 1;
				if (stateCalls === 1) {
					startedFirst?.();
					await firstAnswer;
					return gitOutput(JSON.stringify({ "feature/old": { parents: [{ ref: "main" }] } }));
				}
				return gitOutput(JSON.stringify({ "feature/new": { parents: [{ ref: "main" }] } }));
			}
			return gitOutput();
		});

		const older = service.refresh(repo);
		await firstStarted;
		const newer = service.refresh(repo);
		await newer;
		releaseFirst?.();
		await older;

		expect(service.containsBranch(repo, "feature/new")).toBe(true);
		expect(service.containsBranch(repo, "feature/old")).toBe(false);
	});
});

describe("PR-08 Graphite stack of a branch", () => {
	const branch = (
		name: string,
		parentBranch: string | null,
		extra: Partial<GraphiteBranch> = {},
	): GraphiteBranch => ({ name, trunk: false, needsRestack: false, parentBranch, ...extra });
	const branches: GraphiteBranch[] = [
		branch("main", null, { trunk: true }),
		branch("feat-c", "feat-b"),
		branch("feat-a", "main"),
		branch("other", "main"),
		branch("feat-b", "feat-a", { needsRestack: true }),
	];
	const names = (stack: GraphiteStack) => stack.branches.map((entry) => entry.name);

	it("lists the branch's stack from its top down to the trunk, without other stacks", () => {
		const stack = graphiteStackOf(branches, "feat-b");

		expect(stack.isInStack).toBe(true);
		expect(names(stack)).toEqual(["feat-c", "feat-b", "feat-a", "main"]);
		expect(stack.branches[1]?.needsRestack).toBe(true);
	});

	it("is the same stack read from its lowest branch", () => {
		expect(names(graphiteStackOf(branches, "feat-a"))).toEqual([
			"feat-c",
			"feat-b",
			"feat-a",
			"main",
		]);
	});

	it("is no stack on the trunk, on a branch Graphite does not know, or on an empty state", () => {
		expect(graphiteStackOf(branches, "main")).toEqual({ isInStack: false, branches: [] });
		expect(graphiteStackOf(branches, "elsewhere")).toEqual({ isInStack: false, branches: [] });
		expect(graphiteStackOf([], "feat-b")).toEqual({ isInStack: false, branches: [] });
	});

	it("is no stack for a branch Graphite tracks with no trunk or other branch beside it", () => {
		expect(graphiteStackOf([branch("alone", null)], "alone").isInStack).toBe(false);
	});

	it("still lists every branch when two of them name each other as parent", () => {
		const looped = [branch("x", "y"), branch("y", "x")];

		expect(new Set(names(graphiteStackOf(looped, "x")))).toEqual(new Set(["x", "y"]));
	});
});

describe("PR-08 Graphite poll", () => {
	it("polls the state now and every five seconds until stopped", async () => {
		vi.useFakeTimers();
		let states = 0;
		const { service } = makeService((command) => {
			if (command.program === "gt" && command.args[0] === "--version") return gitOutput("gt 1.0.0");
			if (command.program === "gt" && command.args[0] === "state") {
				states += 1;
				return gitOutput(stateJson);
			}
			return gitOutput();
		});

		const stop = service.watch(repo);
		await vi.advanceTimersByTimeAsync(0);
		expect(states).toBe(1);

		await vi.advanceTimersByTimeAsync(GRAPHITE_POLL_INTERVAL_MS);
		expect(states).toBe(2);

		stop();
		await vi.advanceTimersByTimeAsync(GRAPHITE_POLL_INTERVAL_MS * 3);
		expect(states).toBe(2);
	});

	it("runs no gt command while the switch is off and stops as soon as it is turned on", async () => {
		let disabled = true;
		const { service, git } = makeService(defaultHandler, { disabled: () => disabled });

		await service.refresh(repo);
		expect(git.commands).toHaveLength(0);

		disabled = false;
		await service.refresh(repo);
		expect(git.commands.some((command) => command.args[0] === "state")).toBe(true);
	});

	it("treats a missing gt program as no Graphite, not an error", async () => {
		const { service, git } = makeService((command) => {
			if (command.program === "gt") {
				return { ok: false, error: { code: "process_spawn", message: "not found" } };
			}
			return gitOutput();
		});

		expect(await service.installed(repo)).toEqual(ok(false));
		expect(await service.refresh(repo)).toEqual(ok(undefined));
		expect(git.commands).toHaveLength(1);
	});

	it("starts no poll when a caller only reads the state", async () => {
		vi.useFakeTimers();
		const { service, git } = makeService(defaultHandler);

		expect(service.stateOf(repo)).toBeNull();
		expect(service.parentBranchOf(repo, "feature/two")).toBeNull();
		expect(service.needsRestackOf(repo, "feature/two")).toBe(false);
		expect(service.containsBranch(repo, "feature/two")).toBe(false);
		await vi.advanceTimersByTimeAsync(GRAPHITE_POLL_INTERVAL_MS * 2);

		expect(git.commands).toHaveLength(0);
	});

	it("asks again after a probe that failed, instead of keeping the failure", async () => {
		let probes = 0;
		const { service } = makeService((command) => {
			if (command.program === "gt" && command.args[0] === "--version") {
				probes += 1;
				if (probes === 1) return { ok: false, error: { code: "process_timeout", message: "slow" } };
				return gitOutput("gt 1.0.0");
			}
			return gitOutput();
		});

		const first = await service.installed(repo);
		expect(first.ok).toBe(false);
		expect(await service.installed(repo)).toEqual(ok(true));
		expect(await service.installed(repo)).toEqual(ok(true));
		expect(probes).toBe(2);
	});

	it("keeps a parse failure on the repository instead of showing a partial stack", async () => {
		const { service } = makeService((command) => {
			if (command.program === "gt" && command.args[0] === "--version") return gitOutput("gt 1.0.0");
			if (command.program === "gt" && command.args[0] === "state") return gitOutput("{oops");
			return gitOutput();
		});

		const refreshed = await service.refresh(repo);
		expect(refreshed.ok).toBe(false);
		expect(service.stateOf(repo)?.error?.code).toBe("graphite_parse");
		expect(service.stateOf(repo)?.branches).toEqual([]);
	});
});

describe("PR-08 Graphite checkout", () => {
	it("checks a stack branch out with gt checkout", async () => {
		const { service, git } = makeService(defaultHandler);

		expect(await service.checkout("/code/wt", "feature/one")).toEqual(ok(undefined));
		expect(git.commands.some((command) => command.args[0] === "checkout")).toBe(true);
	});

	it("refuses to check out while the switch is off", async () => {
		const { service, git } = makeService(defaultHandler, { disabled: () => true });

		const checked = await service.checkout("/code/wt", "feature/one");
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.error.code).toBe("graphite_disabled");
		expect(git.commands).toHaveLength(0);
	});

	it("runs nothing when the service has no settings at all", async () => {
		const { service, git } = makeService(defaultHandler, { settingMissing: true });

		await service.refresh(repo);
		expect(git.commands).toHaveLength(0);
	});
});
