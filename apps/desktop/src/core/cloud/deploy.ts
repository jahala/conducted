/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the one deploy at a time the Cloud page can start, and its state: idle, running with the
 * step the shell reports, done with the Worker's URL, or failed with the shell's message.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("Deploying") and D109: the deploy and uninstall
 * run the user's `wrangler` from the app's own inputs. The pairing token is made in Rust and set as
 * a Worker secret there, so it never reaches the web view (D106). Issue #490: the state lives here,
 * not in the page, so leaving and returning shows the running deploy and its result.
 * Must handle: a second deploy while the first runs joins the first instead of uploading twice; an
 * uninstall is passed straight through, because the shell already skips a resource that is gone;
 * a shell that reports no step leaves the step unknown, never invented. Issue #635: the uninstall
 * returns the shell's own count of what it removed.
 * Our design choice: the folder is not a screen input. D109 records why: the app carries what it
 * deploys, and a folder the user prepared was not a deploy flow.
 * Test first: two deploys in a row reach the shell once, and the store keeps the step and the result.
 */
import type { AppError, Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, CloudDeployResult, CloudUninstallResult } from "../../platform/platform.ts";

/** What the page sees of the deploy (CLOUD-08). */
export type CloudDeployState =
	| { state: "idle" }
	| { state: "running"; step: string | null }
	| { state: "done"; url: string }
	| { state: "failed"; error: AppError };

export interface CloudDeployService {
	/** The deploy's state, read through `useCloudDeploy`. */
	readonly store: StoreApi<CloudDeployState>;
	/** True while a deploy is running. */
	readonly deploying: boolean;
	/** Deploys the app's bundled Worker and pairs this Mac. A second call joins the first. */
	deploy(): Promise<Result<CloudDeployResult>>;
	/** Deletes what the deploy made and unpairs this Mac, and says what it removed. */
	uninstall(): Promise<Result<CloudUninstallResult>>;
}

/**
 * `refreshPairing` re-reads the pairing the shell just wrote or removed, so the Cloud page shows
 * it at once. It is the pairing service's `start`, passed in from the composition root.
 */
export function createCloudDeploy(
	cloud: Pick<Cloud, "deploy" | "uninstall" | "onDeployEvent">,
	refreshPairing: () => Promise<Result<void>>,
): CloudDeployService {
	const store = createStore<CloudDeployState>(() => ({ state: "idle" }));
	let running: Promise<Result<CloudDeployResult>> | null = null;
	cloud.onDeployEvent((event) => {
		const current = store.getState();
		if (current.state === "running") {
			store.setState({ state: "running", step: event.step });
		}
	});
	return {
		store,
		get deploying() {
			return running !== null;
		},
		deploy: () => {
			if (running !== null) return running;
			store.setState({ state: "running", step: null });
			running = cloud
				.deploy()
				.then(async (result) => {
					if (result.ok) {
						await refreshPairing();
						store.setState({ state: "done", url: result.value.url }, true);
					} else {
						store.setState({ state: "failed", error: result.error }, true);
					}
					return result;
				})
				.finally(() => {
					running = null;
				});
			return running;
		},
		uninstall: async () => {
			const result = await cloud.uninstall();
			if (result.ok) {
				store.setState({ state: "idle" }, true);
				await refreshPairing();
			}
			return result;
		},
	};
}
