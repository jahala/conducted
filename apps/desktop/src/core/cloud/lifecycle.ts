/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the two lifecycle calls a cloud workspace's archive and delete make on its Worker: stop
 * the sandbox (saving its work and transcripts first) and remove everything the workspace keeps.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (a workspace's calls belong to its Worker) and
 * D105 ("Deleting a workspace (CLOUD-08) ... must delete [the backups]").
 * Must handle: an answer that is not the shape the Worker promises, a 401, and a network failure,
 * each as an Err with a plain message; the call never falls back to the Mac.
 * Our design choice: the routes are `/w/<name>/stop` and `/w/<name>/remove`, beside the existing
 * `start`, because a cloud workspace has no Mac worktree to archive. The Worker's `stop` saves the
 * backups that `start` restores (CLOUD-06), so an unarchive is a local state change and a later
 * start.
 * Test first: an archive reaches `/w/<name>/stop`, and a delete reaches `/w/<name>/remove`.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Cloud } from "../../platform/platform.ts";
import { cloudJson } from "./host-runtime.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

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
