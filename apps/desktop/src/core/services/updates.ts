/**
 * @feature APP-06 App updates that wait until agents are idle
 * @feature PLAT-13 Self-update that waits until agents are idle
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
 * Built now: `isSafeToQuit` (no chat is working), PLAT-13's check (the palette command, the
 * hourly timer and `Actions.app.checkForUpdates` reach it) and its install-and-restart path. The
 * feed publishes notes as text, not a page, so `notesUrl` stays null. Not built here, and APP-06's:
 * the focus re-check, the pre-release channel, the retry toasts, the "You're up to date!" and
 * "already in progress" toasts and the update notice that reads this store.
 * Test first: with the setting on, the state moves to a restart when the last working chat goes idle.
 */
import { appError, err, messageOf, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { UpdateStatus } from "../api.ts";
import { fireAndForget } from "../async/fire-and-forget.ts";
import { createSingleFlight } from "../async/single-flight.ts";

export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;
export const UPDATE_FOCUS_RECHECK_MS = 600_000;
const AUTO_RESTART_SETTING = "auto_restart_on_update_when_idle";

export interface UpdatesServiceDeps {
	platform: Pick<Platform, "updater" | "app">;
	/** True while any chat is working. */
	anyChatWorking: () => boolean;
	setting: <T>(key: string) => T;
}

export class UpdatesService {
	readonly store: StoreApi<UpdateStatus>;
	readonly #deps: UpdatesServiceDeps;
	/** A check asked for while one runs gets that check's answer. */
	readonly #checks = createSingleFlight<"check">();
	#restarting = false;

	constructor(deps: UpdatesServiceDeps) {
		this.#deps = deps;
		this.store = createStore<UpdateStatus>(() => ({
			state: "idle",
			version: null,
			notesUrl: null,
			error: null,
		}));
	}

	/**
	 * Backs `Actions.app.checkForUpdates`, the palette's Check for updates and the hourly check.
	 * A failed check is an error state, never "up to date".
	 */
	check(): Promise<Result<void>> {
		return this.#checks.run("check", async () => {
			this.store.setState({ state: "checking", error: null });
			const found = await this.#deps.platform.updater.check();
			if (!found.ok) {
				this.store.setState({ state: "error", error: found.error.message });
				return found;
			}
			this.store.setState({
				state: found.value === null ? "idle" : "available",
				version: found.value?.version ?? null,
				notesUrl: null,
				error: null,
			});
			return ok(undefined);
		});
	}

	/** Backs `Actions.app.installUpdate`: download, then restart now or when idle. */
	async install(): Promise<Result<void>> {
		this.store.setState({ state: "downloading", error: null });
		const installed = await this.#deps.platform.updater.install();
		if (!installed.ok) {
			this.store.setState({ state: "error", error: installed.error.message });
			return installed;
		}
		this.store.setState({ state: "ready_when_idle", error: null });
		if (this.#restartsWhenIdle()) return this.#restart();
		return ok(undefined);
	}

	/** Called whenever a chat starts or stops working. */
	onActivityChanged(): void {
		if (this.store.getState().state !== "ready_when_idle") return;
		if (!this.#restartsWhenIdle()) return;
		fireAndForget(
			() => this.#restart(),
			(error) => {
				this.store.setState({ state: "error", error: messageOf(error) });
			},
		);
	}

	/** Used by the quit handler. */
	isSafeToQuit(): boolean {
		return !this.#deps.anyChatWorking();
	}

	#restartsWhenIdle(): boolean {
		return (
			this.#deps.setting<boolean>(AUTO_RESTART_SETTING) === true && !this.#deps.anyChatWorking()
		);
	}

	async #restart(): Promise<Result<void>> {
		if (this.#restarting) return ok(undefined);
		this.#restarting = true;
		try {
			await this.#deps.platform.updater.relaunch();
			this.store.setState({ state: "idle", error: null });
			return ok(undefined);
		} catch (cause) {
			const error = appError("app_update_restart_failed", "Conducted could not restart.", cause);
			this.store.setState({ state: "error", error: error.message });
			return err(error);
		} finally {
			this.#restarting = false;
		}
	}
}
