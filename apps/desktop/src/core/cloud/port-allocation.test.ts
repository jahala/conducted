// @vitest-environment node
/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the pure local-port plan: a manual mapping wins and cannot move silently, the match
 * strategy uses a usable remote port, and the range start is stable per workspace.
 * Test first: a mapping 3000:4000 asks for 4000, and a taken 4000 is an error.
 */
import { describe, expect, it } from "vitest";
import { djb2, isForwardablePort, parseMappings, planLocalPort } from "./port-allocation.ts";

const range = { start: 20_000, end: 29_999 };

describe("CLOUD-10 local port plan", () => {
	it("a manual mapping asks for its local port", () => {
		const plan = planLocalPort({
			remotePort: 3000,
			workspaceKey: "ws-1",
			strategy: "range",
			range,
			mappings: [{ remotePort: 3000, localPort: 4000 }],
			taken: new Set(),
		});
		expect(plan.ok && plan.value).toEqual({ pinned: true, preferredPort: 4000 });
	});

	it("a taken manual mapping is an error, never a silent move", () => {
		const plan = planLocalPort({
			remotePort: 3000,
			workspaceKey: "ws-1",
			strategy: "range",
			range,
			mappings: [{ remotePort: 3000, localPort: 4000 }],
			taken: new Set([4000]),
		});
		expect(plan.ok ? null : plan.error.code).toBe("port_forward_mapping_taken");
	});

	it("match uses the remote port when it is at least 1024 and free", () => {
		const plan = planLocalPort({
			remotePort: 5173,
			workspaceKey: "ws-1",
			strategy: "match",
			range,
			mappings: [],
			taken: new Set(),
		});
		expect(plan.ok && plan.value).toEqual({ pinned: false, preferredPort: 5173 });
	});

	it("match never uses a remote port below 1024, port 22 or a taken one", () => {
		for (const remotePort of [80, 22, 5173]) {
			const plan = planLocalPort({
				remotePort,
				workspaceKey: "ws-1",
				strategy: "match",
				range,
				mappings: [],
				taken: remotePort === 5173 ? new Set([5173]) : new Set(),
			});
			expect(plan.ok && plan.value.preferredPort).not.toBe(remotePort);
		}
	});

	it("the range point is stable for one workspace and inside the range", () => {
		const first = planLocalPort({
			remotePort: 3000,
			workspaceKey: "oslo",
			strategy: "range",
			range,
			mappings: [],
			taken: new Set(),
		});
		const again = planLocalPort({
			remotePort: 3000,
			workspaceKey: "oslo",
			strategy: "range",
			range,
			mappings: [],
			taken: new Set(),
		});
		expect(first.ok && first.value.preferredPort).toBe(again.ok ? again.value.preferredPort : -1);
		if (first.ok && first.value.preferredPort !== undefined) {
			expect(first.value.preferredPort).toBeGreaterThanOrEqual(range.start);
			expect(first.value.preferredPort).toBeLessThanOrEqual(range.end);
		}
	});

	it("parses valid mapping lines and skips invalid ones", () => {
		expect(parseMappings(["3000:4000", " 8080 : 9000 ", "22:3000", "nope", "0:1"])).toEqual([
			{ remotePort: 3000, localPort: 4000 },
			{ remotePort: 8080, localPort: 9000 },
		]);
	});

	it("knows which numbers are ports", () => {
		expect(isForwardablePort(1)).toBe(true);
		expect(isForwardablePort(65_535)).toBe(true);
		expect(isForwardablePort(0)).toBe(false);
		expect(isForwardablePort(65_536)).toBe(false);
		expect(isForwardablePort(1.5)).toBe(false);
	});

	it("djb2 is stable", () => {
		expect(djb2("oslo")).toBe(djb2("oslo"));
		expect(djb2("oslo")).not.toBe(djb2("lisbon"));
	});
});
