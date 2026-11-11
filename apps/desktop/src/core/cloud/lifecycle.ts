/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the lifecycle calls a cloud workspace makes on its Worker: the start a creation makes
 * (CLOUD-19), its state (status and resources), a restart, the stop an archive makes (saving its work and transcripts first), and the
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

/**
 * A new cloud workspace's sandbox name: `ws-` and the id's letters and digits, lowercase. It is the
 * Durable Object name the Worker's routes take (`WORKSPACE_NAME` in apps/cloud/src/args.ts: at
 * most 63 lowercase letters, digits and dashes).
 */
export function cloudWorkspaceName(id: string): string {
	return `ws-${id
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
		.slice(0, 32)}`;
}

/**
 * A cloud workspace's folder in its sandbox. It holds the sandbox name, so no two cloud workspaces
 * share a folder and the host lookup by folder finds the right one (D101).
 */
export function cloudWorkspaceFolder(name: string): string {
	return `/workspace/${name}`;
}

/** Conductor's words when a cloud workspace's sandbox cannot be reached (main @3823745). */
export const CLOUD_WORKSPACE_UNREACHABLE =
	"Cloud workspace isn't reachable right now. Try again in a moment.";

/**
 * Starts a cloud workspace's sandbox and waits for its sidecar, as a creation does before it
 * clones. A refusal that is not the Worker's own data-privacy answer is Conductor's "isn't
 * reachable", with the Worker's reason kept as the cause.
 */
export async function startCloudWorkspace(cloud: Cloud, host: CloudHost): Promise<Result<void>> {
	const answer = await cloudJson(cloud, host, "/start", {});
	if (!answer.ok) {
		if (answer.error.code === "cloud_data_privacy") return answer;
		return err(appError("cloud_unreachable", CLOUD_WORKSPACE_UNREACHABLE, answer.error));
	}
	const value = answer.value as { started?: unknown };
	if (typeof value.started !== "boolean") {
		return err(appError("cloud_bad_response", "The Workspace did not say that it started."));
	}
	return ok(undefined);
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
