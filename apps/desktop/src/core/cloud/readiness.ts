/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: asking the paired Worker which secrets it holds (`GET /readiness`) and reading its answer.
 * Behaviour: the Worker's readiness route (apps/cloud/src/readiness.ts) answers booleans for its
 * GitHub token and each model key; the new-workspace page turns them into Conductor's launch
 * reasons (core/organization.ts).
 * Must handle: a Worker that does not answer, refuses the token, or answers something that is not
 * the readiness shape, each as an Err with a plain message; the pairing token is added in Rust, so
 * it is never part of the request here.
 * Test first: the readiness answer is read, and an answer of another shape is refused.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Cloud } from "../../platform/platform.ts";
import type { CloudReadiness } from "../organization.ts";

/** How long the readiness check may take before the page says the computer is not ready. */
export const READINESS_TIMEOUT_MS = 15_000;

/** The readiness answer, or null when `value` is not its shape. */
export function parseCloudReadiness(value: unknown): CloudReadiness | null {
	if (typeof value !== "object" || value === null) return null;
	const answer = value as { github?: unknown; agents?: unknown };
	const agents = answer.agents as
		| { anthropic?: unknown; openai?: unknown; cursor?: unknown }
		| null
		| undefined;
	if (typeof answer.github !== "boolean" || typeof agents !== "object" || agents === null) {
		return null;
	}
	if (
		typeof agents.anthropic !== "boolean" ||
		typeof agents.openai !== "boolean" ||
		typeof agents.cursor !== "boolean"
	) {
		return null;
	}
	return {
		github: answer.github,
		agents: { anthropic: agents.anthropic, openai: agents.openai, cursor: agents.cursor },
	};
}

/** Asks the Worker at `url` which secrets it holds. */
export async function readCloudReadiness(
	cloud: Cloud,
	url: string,
): Promise<Result<CloudReadiness>> {
	const answer = await cloud.request({
		url,
		method: "GET",
		path: "/readiness",
		timeoutMs: READINESS_TIMEOUT_MS,
	});
	if (!answer.ok) return answer;
	if (answer.value.status === 401) {
		return err(
			appError(
				"cloud_not_paired",
				"The Worker refused the pairing token. Pair this Mac with the Worker again.",
			),
		);
	}
	if (answer.value.status < 200 || answer.value.status >= 300) {
		return err(appError("cloud_request_failed", `The Worker answered ${answer.value.status}.`));
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(answer.value.body);
	} catch {
		parsed = null;
	}
	const readiness = parseCloudReadiness(parsed);
	return readiness === null
		? err(
				appError(
					"cloud_bad_response",
					"The Worker's readiness answer was not what the app expected.",
				),
			)
		: ok(readiness);
}
