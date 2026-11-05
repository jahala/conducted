/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests for the port block allocator and the preview URL template expansion.
 * Test first: allocatePort with 55000 and 55010 taken returns 55020.
 */
import { describe, expect, it } from "vitest";
import {
	allocatePort,
	expandPreviewUrl,
	PORT_BASE,
	PORT_BLOCK_SIZE,
	PORT_MAX,
	RESERVED_PORTS,
} from "./ports.ts";

describe("RUN-03 allocatePort", () => {
	it("starts at 55000", () => {
		expect(allocatePort(new Set())).toEqual({ ok: true, value: 55_000 });
	});

	it("takes the next free block", () => {
		expect(allocatePort(new Set([55_000, 55_010]))).toEqual({ ok: true, value: 55_020 });
	});

	it("reuses a gap", () => {
		expect(allocatePort(new Set([55_000, 55_020]))).toEqual({ ok: true, value: 55_010 });
	});

	it("returns an error value when every block is used", () => {
		const all = new Set<number>();
		for (let port = PORT_BASE; port + PORT_BLOCK_SIZE <= PORT_MAX; port += PORT_BLOCK_SIZE) {
			all.add(port);
		}
		expect(allocatePort(all).ok).toBe(false);
	});

	it("never gives port 22, which is reserved for SSH", () => {
		expect(RESERVED_PORTS.has(22)).toBe(true);
		const chosen = allocatePort(new Set());
		expect(chosen.ok && RESERVED_PORTS.has(chosen.value)).toBe(false);
	});
});

describe("RUN-03 expandPreviewUrl", () => {
	it("replaces both spellings of the workspace port variable", () => {
		expect(expandPreviewUrl("http://localhost:$CONDUCTED_PORT/a", 55_010)).toEqual({
			ok: true,
			value: "http://localhost:55010/a",
		});
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the braces are the syntax under test
		expect(expandPreviewUrl("http://localhost:${CONDUCTED_PORT}", 1)).toEqual({
			ok: true,
			value: "http://localhost:1",
		});
	});

	it("also accepts the short port variable", () => {
		expect(expandPreviewUrl("http://localhost:$PORT/app", 3100)).toEqual({
			ok: true,
			value: "http://localhost:3100/app",
		});
	});

	it("keeps a template without variables", () => {
		expect(expandPreviewUrl("http://localhost:3000", 55_000)).toEqual({
			ok: true,
			value: "http://localhost:3000",
		});
	});

	it("rejects unknown variables instead of leaving them half expanded", () => {
		expect(expandPreviewUrl("http://$HOST:$CONDUCTED_PORT", 1).ok).toBe(false);
	});
});
