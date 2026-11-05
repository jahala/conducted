/**
 * @feature PLAT-28 System service: the managed programs and the Mac-level actions screens ask for
 * Owns: installing, downloading again and removing the programs the app manages (D021, D024) and
 * their status store; and small actions on the Mac that screens may not reach the Platform for:
 * copying text and images, saving or opening a file in its own app, Full Disk Access, the sidecar
 * log, the feedback form and the Xcode licence fix.
 * Behaviour: native-and-sidecar-map.md A9 (binary manager), services-map.md 5A.8.1 (download
 * states, retry, send gate), ui-map.md 6 (Agents and Advanced pages, Full Disk Access row), 5.1 and
 * 5.2 (Send feedback), 7.4 (Xcode licence).
 * Must handle: a program that is already downloading (a second install joins it); a failed
 * download keeps its retry state and the Retry button calls install again; a program the user
 * points at a path of their own is shown as theirs and never downloaded over; copying an image
 * that is not an image file fails with a plain message; a save the user cancels is `ok(null)`;
 * System Settings that will not open says where to grant Full Disk Access by hand; feedback opens
 * the project's issue page with the text filled in and never sends logs anywhere by itself.
 * Our design choice: one service for these Mac-level actions, so screens get them through
 * `Actions` like everything else and the Platform stays out of `features/`.
 * Test first: install while a download of the same program runs starts no second download.
 */
import { type ManagedProgram, notImplemented, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { FeedbackInput, Loadable } from "../api.ts";
import type { AgentProgramView } from "../model.ts";

export interface SystemState {
	programs: Loadable<AgentProgramView[]>;
}

export interface SystemServiceDeps {
	platform: Pick<Platform, "programs" | "clipboard" | "dialogs" | "opener" | "system" | "sidecar">;
	setting: <T>(key: string) => T;
}

export class SystemService {
	readonly store: StoreApi<SystemState>;
	readonly #deps: SystemServiceDeps;

	constructor(deps: SystemServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SystemState>(() => ({ programs: { state: "loading" } }));
	}

	/** Loads the program statuses and follows their changes. */
	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("PLAT-28");
	}

	/** Backs `Actions.programs.install`, also the Retry after a failure. */
	installProgram(_program: ManagedProgram): Promise<Result<void>> {
		return notImplemented("PLAT-28");
	}

	/** Backs `Actions.programs.redownload`. */
	redownloadProgram(_program: ManagedProgram): Promise<Result<void>> {
		return notImplemented("PLAT-28");
	}

	/** Backs `Actions.programs.remove`. */
	removeProgram(_program: ManagedProgram): Promise<Result<void>> {
		return notImplemented("PLAT-28");
	}

	/** Backs `Actions.app.copyText`. */
	copyText(_text: string): Promise<Result<void>> {
		return notImplemented("APP-13");
	}

	/** Backs `Actions.attachments.copyImage`. */
	copyImage(_path: string): Promise<Result<void>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.attachments.saveAs`. */
	saveAs(_path: string): Promise<Result<string | null>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.attachments.openExternally`. */
	openExternally(_path: string): Promise<Result<void>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.app.sendFeedback`. */
	sendFeedback(_input: FeedbackInput): Promise<Result<void>> {
		return notImplemented("APP-09");
	}

	/** Backs `Actions.app.openSidecarLogs`. */
	openSidecarLogs(): Promise<Result<void>> {
		return notImplemented("APP-03");
	}

	/** Backs `Actions.app.openFullDiskAccessSettings`. */
	openFullDiskAccessSettings(): Promise<Result<void>> {
		return notImplemented("PLAT-24");
	}

	/** Backs `Actions.app.runXcodeLicenseFix`. */
	runXcodeLicenseFix(): Promise<Result<void>> {
		return notImplemented("GIT-16");
	}
}
