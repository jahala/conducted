// @vitest-environment node
/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests reading the Worker's state answer: the running flag and the CPU, memory and disk readings
 * the header shows, and a refusal of an answer that is not that shape.
 * Test first: a running workspace's resources are read, and a malformed reading is refused.
 */
import { describe, expect, it } from "vitest";
import { parseCloudWorkspaceState, statusOfCloudState } from "./state.ts";

const GIB = 1024 ** 3;

const running = {
	running: true,
	resources: {
		cpu: { capacityCores: 0.25, usedPercent: 40 },
		memory: { totalBytes: GIB, usedPercent: 25 },
		disk: { totalBytes: 4 * GIB, availableBytes: GIB, usedPercent: 75 },
	},
};

describe("CLOUD-15 workspace state", () => {
	it("reads a running workspace's resources", () => {
		expect(parseCloudWorkspaceState(running)).toEqual({
			running: true,
			resources: running.resources,
		});
		expect(statusOfCloudState({ running: true, resources: null })).toBe("running");
	});

	it("reads a stopped workspace with no resources", () => {
		expect(parseCloudWorkspaceState({ running: false, resources: null })).toEqual({
			running: false,
			resources: null,
		});
		expect(statusOfCloudState({ running: false, resources: null })).toBe("stopped");
	});

	it("leaves out a reading that is not the promised shape", () => {
		expect(
			parseCloudWorkspaceState({
				running: true,
				resources: { cpu: { capacityCores: "many" }, memory: null, disk: null },
			}),
		).toEqual({ running: true, resources: { cpu: null, memory: null, disk: null } });
	});

	it("refuses an answer without a running flag", () => {
		expect(parseCloudWorkspaceState({})).toBeNull();
		expect(parseCloudWorkspaceState(null)).toBeNull();
		expect(parseCloudWorkspaceState({ running: "yes", resources: null })).toBeNull();
	});
});
