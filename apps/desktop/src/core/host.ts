/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Owns: `checkHost`, the check a workspace's git, shell, file, terminal, search, lifecycle and chat
 * calls run before they reach anything, and `HostDoor`, the kinds of call.
 * Behaviour: docs/research/conductor/services-map.md 1.2 (shell, file and git calls take a host,
 * and a guard runs before shell and git use; for a cloud host they go over HTTP to the workspace's
 * machine), frontend.md 3c (on a cloud host a chat goes to the cloud instead of the local sidecar).
 * Must handle: a local host passes, and the call goes on to the Mac's Platform exactly as before;
 * a cloud host never falls back to the Mac. Its git, shell and file calls and its chats belong to
 * the user's Worker and its Durable Object (CLOUD-03), which the shell and file adapters in
 * `core/cloud/` and the host-routed sidecar reach. The doors CLOUD-03 does not own stop at their
 * row's placeholder: terminals and run commands at CLOUD-09, file search at CLOUD-11, Open in at
 * CLOUD-12, and archive, unarchive and delete at CLOUD-08.
 * Our design choice: one check, called where a workspace is turned into the folder a call runs in
 * (core/lookups.ts, the terminal service and the workspace services), instead of a host object
 * every call goes through. A local host object would only pass calls on to the Platform (D092).
 * CLOUD-03 removed the cloud stop for the doors it built; the callers' folders now select the
 * runtime, and every door it did not build keeps its own row's placeholder.
 * Test first: a cloud workspace's terminal, search, Open in and lifecycle calls stop at their
 * placeholders, and its git, file and chat calls reach the Worker.
 */
import type { Host } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

/** What a call is about to reach for a workspace. */
export type HostDoor =
	| "git"
	| "shell"
	| "files"
	| "terminals"
	| "search"
	| "open-in"
	| "lifecycle"
	| "sidecar";

/** Returns when `door` can be used on `host`. A cloud host stops at the row that owns its door. */
export function checkHost(host: Host, door: HostDoor): void {
	if (host.kind === "local") return;
	switch (door) {
		case "terminals":
			notImplemented("CLOUD-09");
			return;
		case "search":
			notImplemented("CLOUD-11");
			return;
		case "open-in":
			notImplemented("CLOUD-12");
			return;
		case "lifecycle":
			notImplemented("CLOUD-08");
			return;
		default:
			return;
	}
}
