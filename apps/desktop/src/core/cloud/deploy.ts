/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the one deploy at a time the Connections page can start. The app ships its Worker and the
 * sandbox image's inputs as Tauri resources, so the user chooses nothing and the shell reads the
 * bundled folder; this service only serialises the calls.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("Deploying") and D109: the deploy and uninstall
 * run the user's `wrangler` from the app's own inputs. The pairing token is made in Rust and set as
 * a Worker secret there, so it never reaches the web view (D106).
 * Must handle: a second deploy while the first runs joins the first instead of uploading twice; an
 * uninstall is passed straight through, because the shell already refuses a second one against a
 * resource that is gone.
 * Our design choice: the folder is not a screen input. D109 records why: the app carries what it
 * deploys, and a folder the user prepared was not a deploy flow.
 * Test first: two deploys in a row reach the shell once.
 */
import type { Result } from "@conducted/shared";
import type { Cloud, CloudDeployResult } from "../../platform/platform.ts";

export interface CloudDeployService {
	/** True while a deploy is running. */
	readonly deploying: boolean;
	/** Deploys the app's bundled Worker and pairs this Mac. A second call joins the first. */
	deploy(): Promise<Result<CloudDeployResult>>;
	/** Deletes what the deploy made and unpairs this Mac. */
	uninstall(): Promise<Result<void>>;
}

export function createCloudDeploy(cloud: Pick<Cloud, "deploy" | "uninstall">): CloudDeployService {
	let running: Promise<Result<CloudDeployResult>> | null = null;
	return {
		get deploying() {
			return running !== null;
		},
		deploy: () => {
			if (running !== null) return running;
			running = cloud.deploy().finally(() => {
				running = null;
			});
			return running;
		},
		uninstall: () => cloud.uninstall(),
	};
}
