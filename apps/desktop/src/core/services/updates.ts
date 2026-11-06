/**
 * @feature APP-06 App updates that wait until agents are idle
 * @feature PLAT-13 Self-update that waits until agents are idle
 * Owns: checking for a new version, downloading it, and restarting only when no chat is working.
 * Behaviour: services-map.md 5B.4.1 (auto update: eligibility poll, download retries, restart
 * when idle), 5B.4.2 (manual update), ui-map.md 1.3 (update notice).
 * Must handle: a check while one runs returns the in-progress error; a check during a download or
 * a staged update leaves it and any requested restart alone; a failed download retries
 * twice with a pause and then shows an error state; `ready_when_idle` flips to the restart as soon
 * as the last working chat goes idle, and also when the user chose Restart when idle while the
 * automatic setting is off; the quit handler asks this service whether quitting is safe; a release
 * build ignores a pre-release version.
 * Our design choice: we check at start, then once an hour and after the window regains focus
 * after 10 minutes, instead of every minute. There is no release holdout and no random delay,
 * because there is no shared CDN to protect. The release notes page is the GitHub release for the
 * version our release script tags.
 * Built now: `isSafeToQuit` (no chat is working), PLAT-13's check (the palette command, the hourly
 * timer and `Actions.app.checkForUpdates` reach it) and its install-and-restart path. APP-06 adds
 * the in-progress check result, the channel filter, the download retries, the manual restart that
 * waits for idle, and the notice that reads this store.
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
/** A failed download is tried twice more, this far apart. */
export const UPDATE_DOWNLOAD_RETRIES = 2;
export const UPDATE_DOWNLOAD_RETRY_DELAY_MS = 60_000;
const AUTO_RESTART_SETTING = "auto_restart_on_update_when_idle";

export type UpdateChannel = "dev" | "release";

/** True when the build channel should take this version. A release build skips pre-releases. */
export function versionFitsChannel(version: string, channel: UpdateChannel): boolean {
	if (channel === "dev") return true;
	const withoutBuildMetadata = version.split("+")[0] ?? version;
	return !withoutBuildMetadata.includes("-");
}

/** The GitHub release page `pnpm release` writes for this version. */
export function releaseNotesUrl(version: string): string {
	return `https://github.com/jahala/conducted/releases/tag/v${version}`;
}

const realWait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export interface UpdatesServiceDeps {
	platform: Pick<Platform, "updater" | "app">;
	/** True while any chat is working. */
	anyChatWorking: () => boolean;
	setting: <T>(key: string) => T;
}

export class UpdatesService {
	readonly store: StoreApi<UpdateStatus>;
	readonly #deps: UpdatesServiceDeps;
	/** A check asked for while one runs gets the in-progress error. */
	readonly #checks = createSingleFlight<"check">();
	/** A second install while one runs gets the first install's answer. */
	readonly #installs = createSingleFlight<"install">();
	#restarting = false;
	/** The user chose Restart when idle, so the restart happens even with the setting off. */
	#restartRequested = false;

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
		if (this.#checks.isRunning("check")) {
			return Promise.resolve(
				err(appError("update_check_in_progress", "An update check is already in progress.")),
			);
		}
		return this.#checks.run("check", async () => {
			const current = this.store.getState().state;
			if (current === "ready_when_idle" || current === "downloading") {
				// A staged update or a running download owns the store, and a staged update may
				// also hold the user's Restart when idle. A check must leave both alone.
				return ok(undefined);
			}
			this.store.setState({ state: "checking", error: null });
			const found = await this.#deps.platform.updater.check();
			if (!found.ok) {
				this.store.setState({ state: "error", error: found.error.message });
				return found;
			}
			const offered =
				found.value !== null &&
				versionFitsChannel(found.value.version, this.#deps.platform.app.channel)
					? found.value
					: null;
			this.store.setState({
				state: offered === null ? "idle" : "available",
				version: offered?.version ?? null,
				notesUrl: offered === null ? null : releaseNotesUrl(offered.version),
				error: null,
			});
			return ok(undefined);
		});
	}

	/**
	 * Backs `Actions.app.installUpdate`: download, then restart now or when idle. When the update is
	 * already staged, it restarts (or waits for the last working chat) without downloading again.
	 */
	install(): Promise<Result<void>> {
		return this.#installs.run("install", async () => {
			if (this.store.getState().state === "ready_when_idle") {
				return this.#restartWhenIdle();
			}
			this.#restartRequested = false;
			this.store.setState({ state: "downloading", error: null });
			const installed = await this.#installWithRetry();
			if (!installed.ok) {
				this.store.setState({ state: "error", error: installed.error.message });
				return installed;
			}
			this.store.setState({ state: "ready_when_idle", error: null });
			if (this.#restartsWhenIdle()) return this.#restart();
			return ok(undefined);
		});
	}

	/** Called whenever a chat starts or stops working. */
	onActivityChanged(): void {
		if (this.store.getState().state !== "ready_when_idle") return;
		if (!this.#restartRequested && !this.#restartsWhenIdle()) return;
		if (this.#deps.anyChatWorking()) return;
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

	/** The user's Restart when idle: restart now when no chat works, else on the next idle. */
	async #restartWhenIdle(): Promise<Result<void>> {
		if (this.#deps.anyChatWorking()) {
			this.#restartRequested = true;
			return ok(undefined);
		}
		return this.#restart();
	}

	#restartsWhenIdle(): boolean {
		return (
			this.#deps.setting<boolean>(AUTO_RESTART_SETTING) === true && !this.#deps.anyChatWorking()
		);
	}

	/** Downloads and installs, trying twice more after a failure. */
	async #installWithRetry(): Promise<Result<void>> {
		let attempt = 0;
		while (true) {
			const installed = await this.#deps.platform.updater.install();
			if (installed.ok || attempt >= UPDATE_DOWNLOAD_RETRIES) return installed;
			attempt += 1;
			await realWait(UPDATE_DOWNLOAD_RETRY_DELAY_MS);
		}
	}

	async #restart(): Promise<Result<void>> {
		if (this.#restarting) return ok(undefined);
		this.#restarting = true;
		try {
			await this.#deps.platform.updater.relaunch();
			this.#restartRequested = false;
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
