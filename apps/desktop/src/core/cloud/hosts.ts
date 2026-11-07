/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: answering "which cloud host does this folder belong to" from the workspace store, so the
 * shell and file adapters can send a cloud workspace's calls to its Worker.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (a workspace names its host; its git, shell and
 * file calls belong to the Worker) and D092 (one host check where a folder is handed out).
 * Must handle: a folder outside every cloud workspace returns null, so the call goes to the Mac;
 * two cloud workspaces whose folders share a prefix resolve to the deeper one; a local workspace
 * never wins over a cloud one, because only cloud rows can own a remote folder.
 * Our design choice: a cloud workspace's stored folder is its absolute path inside the sandbox, so
 * the Worker needs no translation and the same string names the folder on both sides. D101 records
 * it.
 * Test first: the longest matching cloud folder wins, and an unrelated folder is null.
 */
import type { Host } from "@conducted/protocol";

/** A workspace row as the lookup needs it. */
export interface HostedFolder {
	path: string;
	host: Host;
}

/** The cloud host that owns `path`, or null when the Mac does. */
export function hostAtPath(
	folders: Iterable<HostedFolder>,
	path: string,
): Extract<Host, { kind: "cloud" }> | null {
	let best: Extract<Host, { kind: "cloud" }> | null = null;
	let bestLength = -1;
	for (const folder of folders) {
		if (folder.host.kind !== "cloud") continue;
		const root = folder.path.replace(/\/$/, "");
		const inside = path === root || path.startsWith(`${root}/`);
		if (!inside || root.length <= bestLength) continue;
		best = folder.host;
		bestLength = root.length;
	}
	return best;
}

/** Reads the workspace rows lazily, so construction order does not matter. */
export function createCloudHosts(
	folders: () => Iterable<HostedFolder>,
): (path: string) => Extract<Host, { kind: "cloud" }> | null {
	return (path) => hostAtPath(folders(), path);
}
