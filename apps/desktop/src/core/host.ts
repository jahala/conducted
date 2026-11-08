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
 * `core/cloud/` and the host-routed sidecar reach; its terminals and run scripts reach the
 * sandbox's PTY through the Worker's terminal stream (CLOUD-09, `core/cloud/terminal.ts`). Its
 * Open in runs the editor against the workspace's SSH door (CLOUD-12, `core/cloud/ssh.ts`). File
 * search is built (CLOUD-11): it reads the workspace's local mirror, so it too passes this check.
 * A cloud workspace's archive, unarchive and delete are built (CLOUD-08) as branches in the
 * workspace service that reach its Worker, so they no longer stop here.
 * Our design choice: one check, called where a workspace is turned into the folder a call runs in
 * (core/lookups.ts, the terminal service and the workspace services), instead of a host object
 * every call goes through. A local host object would only pass calls on to the Platform (D092).
 * CLOUD-03 removed the cloud stop for the doors it built, CLOUD-09 for terminals and run scripts,
 * CLOUD-08 for lifecycle and CLOUD-12 for Open in; the callers' folders now select the runtime.
 * Test first: a cloud workspace's git, file, chat, search, terminal, lifecycle and Open in calls
 * reach the Worker or the local mirror, and never the Mac's own folder.
 */
import type { Host } from "@conducted/protocol";

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

/** Returns when `door` can be used on `host`. Every door is built for both hosts now. */
export function checkHost(host: Host, _door: HostDoor): void {
	if (host.kind === "local") return;
}
