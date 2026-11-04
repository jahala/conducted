/**
 * @feature APP-06 App updates that wait until agents are idle
 * Owns: checking for a new version, downloading it, and restarting only when no chat is working.
 * Behaviour: services-map.md 5B.4.1 (auto update: eligibility poll, download retries, restart
 * when idle), 5B.4.2 (manual update), ui-map.md 1.3 (update notice).
 * Must handle: a check while one runs returns the same result; a failed download retries twice
 * with a pause and then shows an error state; `ready_when_idle` flips to the restart as soon as
 * the last working chat goes idle, and only if the setting `auto_restart_on_update_when_idle` is
 * on, otherwise the user chooses; the quit handler asks this service whether quitting is safe;
 * a pre-release channel only accepts versions of its own channel.
 * Our design choice: we check at start, then once an hour and after the window regains focus
 * after 10 minutes, instead of every minute. There is no release holdout and no random delay,
 * because there is no shared CDN to protect.
 * Test first: with the setting on, the state moves to a restart when the last working chat goes idle.
 */
import { notImplemented, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { UpdateStatus } from "../api.ts";

export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;
export const UPDATE_FOCUS_RECHECK_MS = 600_000;

export interface UpdatesServiceDeps {
	platform: Pick<Platform, "updater" | "app">;
	/** True while any chat is working. */
	anyChatWorking: () => boolean;
	setting: <T>(key: string) => T;
}

export class UpdatesService {
	readonly store: StoreApi<UpdateStatus>;
	readonly #deps: UpdatesServiceDeps;

	constructor(deps: UpdatesServiceDeps) {
		this.#deps = deps;
		this.store = createStore<UpdateStatus>(() => ({
			state: "idle",
			version: null,
			notesUrl: null,
			error: null,
		}));
	}

	/** Backs `Actions.app.checkForUpdates`. */
	check(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("APP-06");
	}

	/** Backs `Actions.app.installUpdate`: download, then restart now or when idle. */
	install(): Promise<Result<void>> {
		return notImplemented("PLAT-13");
	}

	/** Called whenever a chat starts or stops working. */
	onActivityChanged(): void {
		notImplemented("PLAT-13");
	}

	/** Used by the quit handler. */
	isSafeToQuit(): boolean {
		return notImplemented("PLAT-13");
	}
}
