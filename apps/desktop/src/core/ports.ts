/**
 * @feature RUN-03 Preview URLs and port blocks
 * Owns: the rule that fills the workspace port into a run action's preview URL template. The port
 * service that allocates blocks imports it.
 * Behaviour: services-map.md 5A.1.6 (preview URL variables).
 */
import { appError, err, ok, type Result } from "@conducted/shared";

/** Replaces `$PORT`, `${PORT}`, `$CONDUCTED_PORT` and `${CONDUCTED_PORT}` in a template. */
export function expandPreviewUrl(template: string, port: number): Result<string> {
	const withPort = template.replace(
		/\$\{(?:CONDUCTED_PORT|PORT)\}|\$(?:CONDUCTED_PORT|PORT)\b/g,
		String(port),
	);
	const leftover = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.exec(withPort);
	return leftover
		? err(appError("preview_url_invalid", `Unknown variable ${leftover[0]} in the preview URL.`))
		: ok(withPort);
}
