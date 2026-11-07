/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Owns: the check the pairing form and its service run before the Rust shell is asked anything:
 * the Worker URL is https and cannot name another host, and the token is not blank.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 and the CLOUD-02 spike's question 4
 * (docs/research/cloud-spike-2026-11-06.md): 32 random bytes made at setup, stored on the Mac;
 * the app checks the URL and token with the Worker before it keeps them.
 * Must handle: a URL that is not https, holds a user name or password, a query or a fragment, or
 * names no host; a trailing slash, which is dropped so the Worker URL has one spelling; a token
 * pasted with a newline around it (trimmed), and a blank token (refused).
 * Our design choice: the same URL rules as the Rust shell's `checked_worker_url`, repeated here so
 * the form can answer before a round trip; the shell still checks again. D104 records the pairing.
 * Test first: a plain-http URL is refused and a token of spaces is refused.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { CloudPairInput } from "../../platform/platform.ts";

/** The URL and token the form typed; the Platform's own input shape, one home for it. */
export type PairingInput = CloudPairInput;

/** A Worker URL with one spelling: https, a host, no credentials, query, fragment or last slash. */
export function checkWorkerUrl(raw: string): Result<string> {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return err(appError("cloud_url_not_allowed", "That Worker URL is not valid."));
	}
	if (url.protocol !== "https:" || url.hostname === "") {
		return err(appError("cloud_url_not_allowed", "A Worker URL must be https and name a host."));
	}
	if (url.username !== "" || url.password !== "") {
		return err(
			appError("cloud_url_not_allowed", "A Worker URL cannot hold a user name or password."),
		);
	}
	if (url.search !== "" || url.hash !== "") {
		return err(
			appError("cloud_url_not_allowed", "A Worker URL cannot hold a query or a fragment."),
		);
	}
	return ok(url.toString().replace(/\/$/, ""));
}

/** The checked URL and token the shell will use. A token keeps no surrounding whitespace. */
export function checkPairingInput(input: PairingInput): Result<PairingInput> {
	const url = checkWorkerUrl(input.url);
	if (!url.ok) return url;
	const token = input.token.trim();
	if (token === "") {
		return err(appError("cloud_token_invalid", "A pairing token is needed."));
	}
	return ok({ url: url.value, token });
}
