import { describe, expect, it } from "vitest";
import { allocatePort, expandPreviewUrl } from "./ports.ts";

describe("allocatePort", () => {
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
		for (let p = 55_000; p <= 65_000; p += 10) all.add(p);
		expect(allocatePort(all).ok).toBe(false);
	});
});

describe("expandPreviewUrl", () => {
	it("replaces both spellings of the variable", () => {
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
	it("keeps a template without variables", () => {
		expect(expandPreviewUrl("http://localhost:3000", 55_000)).toEqual({
			ok: true,
			value: "http://localhost:3000",
		});
	});
	it("rejects unknown variables", () => {
		expect(expandPreviewUrl("http://$HOST:$CONDUCTED_PORT", 1).ok).toBe(false);
	});
});
