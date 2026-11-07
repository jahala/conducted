/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the lifecycle calls a cloud workspace makes on its Worker: its state (status and
 * resources), a restart, the stop an archive makes (saving its work and transcripts first), and the
 * remove a delete makes (everything the workspace keeps).
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (a workspace's calls belong to its Worker) and
 * D105 ("Deleting a workspace (CLOUD-08) ... must delete [the backups]"). The header's status and
 * meters are ui-map.md 3.1; they come from the sandbox through the Worker (D116).
 * Must handle: an answer that is not the shape the Worker promises, a 401, and a network failure,
 * each as an Err with a plain message; the call never falls back to the Mac.
 * Our design choice: the routes are `/w/<name>/state`, `/w/<name>/restart`, `/w/<name>/stop` and
 * `/w/<name>/remove`, beside the existing `start`, because a cloud workspace has no Mac worktree to
 * archive. The Worker's `stop` saves the backups that `start` restores (CLOUD-06), so an unarchive
 * is a local state change and a later start. A restart is the Worker's own stop-then-start, so the
 * app makes one call, not two.
 * Test first: an archive reaches `/w/<name>/stop`, and a restart reaches `/w/<name>/restart`.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Cloud } from "../../platform/platform.ts";
import { cloudJson } from "./host-runtime.ts";
import { type CloudWorkspaceState, parseCloudWorkspaceState } from "./state.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** Reads a cloud workspace's status and resource meters without starting its sandbox. */
export async function readCloudWorkspaceState(
	cloud: Cloud,
	host: CloudHost,
): Promise<Result<CloudWorkspaceState>> {
	const answer = await cloudJson(cloud, host, "/state", undefined, 15_000);
	if (!answer.ok) return answer;
	const state = parseCloudWorkspaceState(answer.value);
	return state === null
		? err(
				appError(
					"cloud_bad_response",
					"The Workspace's state answer was not what the app expected.",
				),
			)
		: ok(state);
}

/** Restarts a cloud workspace: the Worker saves its work, stops it and starts it again. */
export async function restartCloudWorkspace(cloud: Cloud, host: CloudHost): Promise<Result<void>> {
	const answer = await cloudJson(cloud, host, "/restart", {});
	if (!answer.ok) return answer;
	const value = answer.value as { started?: unknown };
	if (value.started !== true) {
		return err(appError("cloud_bad_response", "The Workspace did not say that it restarted."));
	}
	return ok(undefined);
}

/** Saves a cloud workspace's work to R2 and stops its sandbox. */
export async function stopCloudWorkspace(cloud: Cloud, host: CloudHost): Promise<Result<void>> {
	const answer = await cloudJson(cloud, host, "/stop", {});
	if (!answer.ok) return answer;
	const value = answer.value as { running?: unknown };
	if (value.running !== false) {
		return err(
			appError("cloud_bad_response", "The Workspace did not say that its sandbox stopped."),
		);
	}
	return ok(undefined);
}

/** Deletes a cloud workspace's backups, sandbox and stored state. */
export async function removeCloudWorkspace(cloud: Cloud, host: CloudHost): Promise<Result<void>> {
	const answer = await cloudJson(cloud, host, "/remove", {});
	if (!answer.ok) return answer;
	const value = answer.value as { deletedBackups?: unknown };
	if (typeof value.deletedBackups !== "number") {
		return err(appError("cloud_bad_response", "The Workspace did not say what it deleted."));
	}
	return ok(undefined);
}
