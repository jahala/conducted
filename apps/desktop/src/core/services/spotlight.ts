/**
 * @feature RUN-02 Spotlight: test workspace changes in the repo root, restore on stop
 * Owns: starting and stopping Spotlight for a workspace: save the repository root, run the sync
 * loop, restore the root when it stops, and repair after a crash.
 * Behaviour: services-map.md 5A.2 (gating, start sequence, the sync loop, stop and restore, state
 * fields), 3.12.3 (pre-spotlight checkpoint), ui-map.md 3.7 (Use spotlight testing, Start
 * spotlight).
 * Must handle: only when the repository setting is on; the root must not be in the middle of a
 * merge or rebase and must be on a branch (clear error text that says what to run); a leftover
 * `pre-spotlight` checkpoint from a crash is restored and removed before a new start; starting
 * Spotlight stops any other Spotlight (one root, one workspace at a time); the sync loop is
 * bin/spotlighter.sh in a terminal of kind "spotlight"; stopping restores the root, and a failed
 * restore keeps the checkpoint so the next start can heal it; quitting the app does not restore
 * (the next start does); the root's branch pointer moves while Spotlight runs (tell the user).
 * Our design choice: the saved id and the helper scripts come from core/git/refs.ts and
 * core/app-paths.ts, so bin/ and the UI agree. File watching is done by the script, not the UI.
 * Test first: starting with a leftover pre-spotlight checkpoint restores it before saving a new one.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { RunState } from "../api.ts";
import type { GitRunner } from "../git/runner.ts";
import type { TerminalsService } from "./terminals.ts";

export interface SpotlightState {
	/** The workspace whose changes are mirrored into its repository root, if any. */
	active: Readonly<Record<string, RunState["spotlight"]>>;
}

export interface SpotlightPreflight {
	ok: boolean;
	/** Plain-language reason, with the command the user can run, when `ok` is false. */
	problem: string | null;
}

export interface SpotlightServiceDeps {
	git: GitRunner;
	terminals: Pick<TerminalsService, "runScript" | "stop">;
	checkpointerPath: string;
	spotlighterPath: string;
}

export class SpotlightService {
	readonly store: StoreApi<SpotlightState>;
	readonly #deps: SpotlightServiceDeps;

	constructor(deps: SpotlightServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SpotlightState>(() => ({ active: {} }));
	}

	/** Checks the root repository: no merge or rebase in progress and a branch is checked out. */
	preflight(_repoRootPath: string): Promise<Result<SpotlightPreflight>> {
		void this.#deps;
		return notImplemented("RUN-02");
	}

	/** Backs `Actions.run.startSpotlight`. */
	start(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("RUN-02");
	}

	/** Backs `Actions.run.stopSpotlight`. */
	stop(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("RUN-02");
	}

	/** Restores a leftover pre-spotlight checkpoint of a repository, if one exists. */
	healAfterCrash(_repoRootPath: string): Promise<Result<boolean>> {
		return notImplemented("RUN-02");
	}
}
