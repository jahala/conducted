/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Owns: the host value a workspace carries, `zHost`, and `LOCAL_HOST`.
 * Behaviour: docs/research/conductor/services-map.md 1.2 (a host is a server URL and a VM id; the
 * local host has neither), frontend.md 3c (the query options carry the host).
 * Our design choice: a tagged value, `{ kind: "local" }` or `{ kind: "cloud", url, vmId }`, in
 * place of Conductor's `{ hostingServerUrl: "/", vmId: "" }` for local, so "is this cloud?" reads
 * the tag instead of comparing a URL with a sentinel (D092). `url` is the user's Worker and
 * `vmId` names the workspace's sandbox (docs/plans/cloud-and-remote.md Part 1).
 * Test first: a cloud host without a URL or a VM id is refused.
 */
import { z } from "zod";

export const zHost = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("local") }).strict(),
	z
		.object({
			kind: z.literal("cloud"),
			/** The user's Worker, for example "https://conducted.example.workers.dev". */
			url: z.string().min(1),
			/** The sandbox the workspace runs in. */
			vmId: z.string().min(1),
		})
		.strict(),
]);
export type Host = z.infer<typeof zHost>;

/** The Mac this app runs on. Every workspace made on the Mac has this host. */
export const LOCAL_HOST: Host = Object.freeze({ kind: "local" });
