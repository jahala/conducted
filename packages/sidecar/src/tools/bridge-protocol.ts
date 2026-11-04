/**
 * @feature SIDE-13 App tools over a socket bridge: wire format
 * Owns: the one-line messages between the app-tools MCP helper process and the sidecar's bridge
 * socket, and the limits around them.
 * Behaviour: research/conductor/claude-runner.md section 4.3 and native-and-sidecar-map.md B5
 * "codex-mcp": one JSON line per connection, { authToken, sessionId, toolName, args } or a hello
 * with the helper's pid; a per-session token authenticates; sockets time out after 30 s of
 * silence.
 * Must handle: a message that does not parse (answer with an error line, close), a token that does
 * not match the session (answer unauthorized, close, log a warning without the token), a tool name
 * that is not an app tool or is not enabled for the session (error line), and a line longer than
 * the limit (close).
 * Test first: parseBridgeRequest rejects a request without authToken and accepts a hello.
 * Our design choice: the answer is also one JSON line, { ok, text, isError } or { ok: false,
 * error }, and the connection closes after it. Conductor's helper does the same per call.
 */
import { zAppTool, zSessionId } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { z } from "zod";

export const BRIDGE_IDLE_TIMEOUT_MS = 30_000;
export const BRIDGE_MAX_LINE_CHARS = 1024 * 1024;
/** Length of the random per-session token in bytes before base64url encoding. */
export const BRIDGE_TOKEN_BYTES = 32;

export const zBridgeRequest = z.union([
	z.object({
		authToken: z.string().min(1),
		sessionId: zSessionId,
		hello: z.object({ pid: z.number().int().positive() }),
	}),
	z.object({
		authToken: z.string().min(1),
		sessionId: zSessionId,
		toolName: zAppTool,
		args: z.unknown(),
	}),
]);
export type BridgeRequest = z.infer<typeof zBridgeRequest>;

export const zBridgeResponse = z.union([
	z.object({ ok: z.literal(true), text: z.string(), isError: z.boolean() }),
	z.object({ ok: z.literal(false), error: z.string() }),
]);
export type BridgeResponse = z.infer<typeof zBridgeResponse>;

export function parseBridgeRequest(line: string): Result<BridgeRequest, AppError> {
	let json: unknown;
	try {
		json = JSON.parse(line);
	} catch (cause) {
		return err(appError("bridge_invalid_json", "The bridge request was not valid JSON", cause));
	}
	const parsed = zBridgeRequest.safeParse(json);
	if (!parsed.success) {
		return err(
			appError("bridge_invalid_request", parsed.error.issues.map((i) => i.message).join("; ")),
		);
	}
	return ok(parsed.data);
}

export function isHello(
	request: BridgeRequest,
): request is Extract<BridgeRequest, { hello: unknown }> {
	return "hello" in request;
}
