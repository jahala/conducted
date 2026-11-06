/**
 * @feature PR-08 Read-only Graphite stacks
 * Owns: probing the `gt` program, polling `gt state` for a repository, parsing its branches, the
 * branch's parent and restack flag, and the one `gt checkout` action.
 * Behaviour: services-map.md 3.8.1 (the install probe, the 5 s local poll with its switch, and the
 * only mutating `gt` call), 3.0.2 (the 30 s timeout), 3.0.5 (the state JSON and its branch names),
 * 5B.1.8 (read-only plus checkout), ui-map.md 6 Experimental (the inverted `graphite_disabled` key).
 * Must handle: `gt` missing (the probe says so and no poll runs), a probe that failed (not kept, so
 * the next read asks again), the switch read on every use so turning it off stops the commands at
 * once, invalid JSON or a branch name outside the allowed characters (an error, never a partial
 * stack), a `gt state` that could not run or printed what the parser refuses (the error is kept on
 * the repository), two overlapping reads where only the newest may write, and a checkout refused
 * while Graphite is off. A `gt state` that exits non-zero reads as no stack with no error, as the
 * research's `|| echo "{}"` does, so a broken `gt` install looks like a repository without a stack.
 * Our design choice: the state is keyed by the repository's main worktree. The git panel watches
 * the repository of the workspace it shows and releases it when it unmounts, so only the visible
 * repository polls, and nothing subscribes at startup (services-map.md 6). The reads only read the
 * store; they never start a poll. `dispose` stops every timer.
 * Test first: two branches of a parsed state keep their parent and restack flag.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { z } from "zod";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { graphiteCheckout, graphiteInstalled, graphiteState } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";

export const GRAPHITE_POLL_INTERVAL_MS = 5_000;
/** The branch names the state parser accepts (services-map.md 3.0.5). */
export const GRAPHITE_BRANCH_PATTERN = /^[A-Za-z0-9._/@+-]+$/;

export interface GraphiteBranch {
	name: string;
	trunk: boolean;
	needsRestack: boolean;
	parentBranch: string | null;
}

export interface GraphiteRepoState {
	branches: readonly GraphiteBranch[];
	error: AppError | null;
	refreshedAt: number | null;
}

export interface GraphiteState {
	byRepo: Readonly<Record<string, GraphiteRepoState>>;
}

const BranchSchema = z
	.object({
		trunk: z.boolean().optional(),
		needs_restack: z.boolean().optional(),
		parents: z
			.array(z.object({ ref: z.string().regex(GRAPHITE_BRANCH_PATTERN) }).passthrough())
			.optional(),
	})
	.passthrough();

const StateSchema = z.record(z.string().regex(GRAPHITE_BRANCH_PATTERN), BranchSchema);

/** Reads the JSON `gt state` prints into one entry per branch, in its own order. */
export function parseGraphiteState(text: string): Result<GraphiteBranch[]> {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (cause) {
		return err(appError("graphite_parse", "Graphite's state is not valid JSON.", cause));
	}
	const parsed = StateSchema.safeParse(json);
	if (!parsed.success) {
		return err(
			appError("graphite_parse", "Graphite's state has a branch or field this app cannot read."),
		);
	}
	const branches: GraphiteBranch[] = [];
	for (const [name, value] of Object.entries(parsed.data)) {
		const parent = value.parents?.[0]?.ref ?? null;
		branches.push({
			name,
			trunk: value.trunk === true,
			needsRestack: value.needs_restack === true,
			parentBranch: value.trunk === true ? null : parent,
		});
	}
	return ok(branches);
}

export interface GraphiteServiceDeps {
	git: GitRunner;
	/**
	 * Reads `graphite_disabled`. The container always supplies it. When it is absent the switch is
	 * read as off, so a service built without settings never runs `gt`.
	 */
	setting?: <T>(key: string) => T;
	now: () => number;
	/** The poll interval. Passed in so tests do not wait. */
	pollIntervalMs?: number;
}

interface WatchEntry {
	count: number;
	stopped: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

export class GraphiteService {
	readonly store: StoreApi<GraphiteState>;
	readonly #deps: GraphiteServiceDeps;
	readonly #latest = createLatestWins<string>();
	readonly #watchers = new Map<string, WatchEntry>();
	#installed: Promise<Result<boolean>> | undefined;

	constructor(deps: GraphiteServiceDeps) {
		this.#deps = deps;
		this.store = createStore<GraphiteState>(() => ({ byRepo: {} }));
	}

	/**
	 * Whether the `gt` program can run. An answer is read once and kept, as the research caches it.
	 * A probe that failed is not kept, so one passing error does not hide Graphite until a restart.
	 */
	async installed(cwd: string): Promise<Result<boolean>> {
		this.#installed ??= this.#probe(cwd);
		const pending = this.#installed;
		const result = await pending;
		if (!result.ok && this.#installed === pending) this.#installed = undefined;
		return result;
	}

	async #probe(cwd: string): Promise<Result<boolean>> {
		const result = await this.#deps.git.run(graphiteInstalled(), { cwd });
		if (!result.ok) {
			return result.error.code === "process_spawn" ? ok(false) : err(result.error);
		}
		return ok(true);
	}

	/** The Graphite state of a repository, or null before the first read answered. */
	stateOf(repoRootPath: string): GraphiteRepoState | null {
		return this.store.getState().byRepo[repoRootPath] ?? null;
	}

	/** The parent branch Graphite reports for this branch, or null outside a stack. */
	parentBranchOf(repoRootPath: string, branch: string): string | null {
		const state = this.stateOf(repoRootPath);
		return state?.branches.find((entry) => entry.name === branch)?.parentBranch ?? null;
	}

	/** Whether Graphite says this branch needs a restack. */
	needsRestackOf(repoRootPath: string, branch: string): boolean {
		const state = this.stateOf(repoRootPath);
		return state?.branches.some((entry) => entry.name === branch && entry.needsRestack) ?? false;
	}

	/** Whether Graphite knows this branch, so a switch can use `gt checkout`. */
	containsBranch(repoRootPath: string, branch: string): boolean {
		const state = this.stateOf(repoRootPath);
		return state?.branches.some((entry) => entry.name === branch) ?? false;
	}

	/** Starts polling a repository until the returned function is called. */
	watch(repoRootPath: string): Unsubscribe {
		const existing = this.#watchers.get(repoRootPath);
		if (existing !== undefined) {
			existing.count += 1;
			return () => this.#unwatch(repoRootPath);
		}
		const entry: WatchEntry = { count: 1, stopped: false, timer: null };
		this.#watchers.set(repoRootPath, entry);
		const tick = async (): Promise<void> => {
			if (entry.stopped) return;
			await this.refresh(repoRootPath);
			if (entry.stopped) return;
			entry.timer = setTimeout(() => {
				void tick();
			}, this.#deps.pollIntervalMs ?? GRAPHITE_POLL_INTERVAL_MS);
		};
		void tick();
		return () => this.#unwatch(repoRootPath);
	}

	#unwatch(repoRootPath: string): void {
		const entry = this.#watchers.get(repoRootPath);
		if (entry === undefined) return;
		entry.count -= 1;
		if (entry.count > 0) return;
		entry.stopped = true;
		if (entry.timer !== null) clearTimeout(entry.timer);
		this.#watchers.delete(repoRootPath);
		this.#latest.invalidate(repoRootPath);
	}

	/**
	 * Reads `gt state` once. Only the newest read of a repository writes the store; an older answer
	 * that arrives late is dropped. The switch is read here, so turning it off stops the command.
	 */
	async refresh(repoRootPath: string): Promise<Result<void>> {
		if (this.#disabled()) {
			this.#write(repoRootPath, { branches: [], error: null, refreshedAt: this.#deps.now() });
			return ok(undefined);
		}
		const installed = await this.installed(repoRootPath);
		if (!installed.ok) return err(installed.error);
		if (!installed.value) {
			this.#write(repoRootPath, { branches: [], error: null, refreshedAt: this.#deps.now() });
			return ok(undefined);
		}

		const ticket = this.#latest.begin(repoRootPath);
		const result = await this.#deps.git.run(graphiteState(), { cwd: repoRootPath });
		const latest = this.#latest.isLatest(ticket);
		this.#latest.settle(ticket);
		if (!latest) return ok(undefined);

		if (!result.ok) {
			this.#write(repoRootPath, {
				branches: [],
				error: result.error,
				refreshedAt: this.#deps.now(),
			});
			return err(result.error);
		}
		// `gt state` exits non-zero outside a Graphite repository, which reads as no stack.
		if (result.value.exitCode !== 0) {
			this.#write(repoRootPath, { branches: [], error: null, refreshedAt: this.#deps.now() });
			return ok(undefined);
		}
		const parsed = parseGraphiteState(result.value.stdout);
		if (!parsed.ok) {
			this.#write(repoRootPath, {
				branches: [],
				error: parsed.error,
				refreshedAt: this.#deps.now(),
			});
			return err(parsed.error);
		}
		this.#write(repoRootPath, {
			branches: parsed.value,
			error: null,
			refreshedAt: this.#deps.now(),
		});
		return ok(undefined);
	}

	/** Runs `gt checkout` for a branch Graphite knows. Refused while the switch is off. */
	async checkout(workspacePath: string, branch: string): Promise<Result<void>> {
		if (this.#disabled()) {
			return err(appError("graphite_disabled", "Graphite stack detection is turned off."));
		}
		const checked = await this.#deps.git.runChecked(graphiteCheckout(branch), {
			cwd: workspacePath,
		});
		return checked.ok ? ok(undefined) : err(checked.error);
	}

	/** Stops every poller and drops its timer. The container's `stop()` calls it. */
	dispose(): void {
		for (const [key, entry] of this.#watchers) {
			entry.stopped = true;
			if (entry.timer !== null) clearTimeout(entry.timer);
			this.#latest.invalidate(key);
		}
		this.#watchers.clear();
	}

	#disabled(): boolean {
		const setting = this.#deps.setting;
		return setting === undefined || setting<boolean>("graphite_disabled") === true;
	}

	#write(repoRootPath: string, state: GraphiteRepoState): void {
		this.store.setState((current) => ({
			byRepo: { ...current.byRepo, [repoRootPath]: state },
		}));
	}
}
