// @vitest-environment node
import { describe, expect, it } from "vitest";
import { conductorTime, parseConductorRows } from "./conductor-rows.ts";

describe("APP-17 Conductor's rows", () => {
	it("conductorTime reads 2026-01-02 03:04:05 as that moment in UTC", () => {
		expect(conductorTime("2026-01-02 03:04:05")).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
	});

	it("reads Conductor's other time forms and refuses anything else", () => {
		expect(conductorTime("2026-01-02T03:04:05.250Z")).toBe(Date.UTC(2026, 0, 2, 3, 4, 5, 250));
		expect(conductorTime("2026-01-02T05:04:05+02:00")).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
		expect(conductorTime("2026-01-02T05:04:05+0200")).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
		expect(conductorTime(1_767_000_000)).toBe(1_767_000_000_000);
		expect(conductorTime(1_767_000_000_123)).toBe(1_767_000_000_123);
		expect(conductorTime("yesterday")).toBeNull();
		expect(conductorTime(0)).toBeNull();
		expect(conductorTime(null)).toBeNull();
	});

	it("leaves out a row it cannot read and keeps the others", () => {
		const { rows, unreadable } = parseConductorRows({
			tables: {
				repos: [{ id: "r-1", name: "alpha" }, { id: 7, name: "bad id" }, { name: "no id" }],
				workspaces: null,
			},
			counts: {},
		});
		expect(rows.repos.map((repo) => repo.id)).toEqual(["r-1"]);
		expect(rows.repos[0]).toMatchObject({ hidden: false, root_path: null });
		expect(unreadable).toEqual({ repos: 2 });
		expect(rows.workspaces).toEqual([]);
		expect(rows.sessions).toEqual([]);
	});
});
