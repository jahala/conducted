/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: newline-delimited JSON framing. One JSON-RPC message per line, in both directions.
 * Behaviour: research/conductor/sessions.md section 10 "Framing" (the connection handler splits
 * incoming bytes on "\n").
 * Must handle: a message split over several chunks, several messages in one chunk, CRLF line ends,
 * blank lines (skipped), a line that is not valid JSON (reported, the next line still parses), and
 * a line longer than the limit (dropped up to its newline, reported once).
 * Test first: "{\"a\":1}\n{\"b\"" then ":2}\n" yields two values, split across the chunk border.
 * Our design choice: the line limit of 16 MiB is ours. Conductor sends batches up to about 0.8 MiB,
 * so the limit leaves room for one large tool result.
 */
import { type AppError, appError } from "@conducted/shared";

export const MAX_LINE_CHARS = 16 * 1024 * 1024;

export type DecodedLine =
	| { ok: true; value: unknown }
	| { ok: false; error: AppError; raw: string };

/** Turns one message into one line, including the trailing newline. */
export function encodeLine(message: unknown): string {
	return `${JSON.stringify(message)}\n`;
}

/** Collects text chunks and returns the complete lines they contain. One decoder per connection. */
export class LineDecoder {
	private pending = "";
	private skippingOversizeLine = false;

	constructor(private readonly maxLineChars: number = MAX_LINE_CHARS) {}

	push(chunk: string): DecodedLine[] {
		const out: DecodedLine[] = [];
		let rest = this.pending + chunk;
		this.pending = "";
		for (;;) {
			const newline = rest.indexOf("\n");
			if (newline === -1) break;
			const line = rest.slice(0, newline);
			rest = rest.slice(newline + 1);
			if (this.skippingOversizeLine) {
				this.skippingOversizeLine = false;
				continue;
			}
			const decoded = decodeLine(line, this.maxLineChars);
			if (decoded) out.push(decoded);
		}
		if (rest.length > this.maxLineChars) {
			if (!this.skippingOversizeLine) {
				this.skippingOversizeLine = true;
				out.push({
					ok: false,
					error: appError(
						"line_too_long",
						`A message was longer than ${this.maxLineChars} characters`,
					),
					raw: "",
				});
			}
			return out;
		}
		this.pending = this.skippingOversizeLine ? "" : rest;
		return out;
	}
}

function decodeLine(rawLine: string, maxLineChars: number): DecodedLine | null {
	const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
	if (line.trim() === "") return null;
	if (line.length > maxLineChars) {
		return {
			ok: false,
			error: appError("line_too_long", `A message was longer than ${maxLineChars} characters`),
			raw: "",
		};
	}
	try {
		return { ok: true, value: JSON.parse(line) };
	} catch (cause) {
		return {
			ok: false,
			error: appError("invalid_json", "A line was not valid JSON", cause),
			raw: line,
		};
	}
}
