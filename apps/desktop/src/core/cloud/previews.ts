/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the desktop's preview door: it asks the Worker for one sandbox port's shareable URL and
 * refuses a port a preview may not use.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 point 7 (previews go through the Worker's port
 * forwarding) and ui-map.md 3.7 (a port is shared as a "Preview URL" the user can copy; moving it
 * up or down is UI order, not a server rule).
 * Must handle: port 22, which the research reserves for SSH; a port outside 1 to 65535; a Worker
 * that refuses, whose own message is shown.
 * Our design choice: the URL's unguessable token is derived by the Worker from its pairing token,
 * the workspace name and the port, so the Worker stores no preview state. D108 records the preview
 * hostname gap: the URL lives under the Worker's own hostname, not a hostname per preview.
 * Test first: port 3000 asks `/preview-url` with its port and returns the URL the Worker gave.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Cloud } from "../../platform/platform.ts";
import { cloudJson } from "./host-runtime.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** Ports a preview may not use. 22 is SSH, which the research says is reserved. */
export const RESERVED_PREVIEW_PORTS: readonly number[] = [22];

/** True when `port` is a number a preview may share. */
export function shareablePort(port: number): boolean {
	return (
		Number.isInteger(port) && port >= 1 && port <= 65_535 && !RESERVED_PREVIEW_PORTS.includes(port)
	);
}

/**
 * The shareable URL for one port in a cloud workspace. The URL is public: its unguessable path is
 * the capability, so it can be copied to anyone the user wants to show the preview.
 */
export async function previewUrlFor(
	cloud: Cloud,
	host: CloudHost,
	port: number,
): Promise<Result<string>> {
	if (!shareablePort(port)) {
		return port === 22
			? err(
					appError(
						"preview_port_reserved",
						"Port 22 is reserved for SSH and cannot be shared as a preview.",
					),
				)
			: err(appError("preview_port_invalid", "That is not a port a preview can share."));
	}
	const answer = await cloudJson(cloud, host, "/preview-url", { port });
	if (!answer.ok) return answer;
	const url = (answer.value as { url?: unknown }).url;
	if (typeof url !== "string" || url === "") {
		return err(appError("cloud_bad_response", "The Workspace's preview answer was not a URL."));
	}
	return ok(url);
}
