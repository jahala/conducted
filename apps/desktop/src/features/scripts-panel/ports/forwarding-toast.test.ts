/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the "Forwarding ports" toast Conductor shows after Cmd+Y turns forwarding on: a success
 * toast whose description lists up to three local ports with the process behind each.
 * Test first: lists the local ports and their process names.
 */
import { describe, expect, it } from "vitest";
import type { PortForwardView } from "../../../core/api.ts";
import { forwardingToast } from "./forwarding-toast.ts";

const view = (overrides: Partial<PortForwardView> = {}): PortForwardView => ({
	forwardingEnabled: true,
	autoForwardEnabled: false,
	waiting: false,
	forwards: [
		{
			id: "a",
			remotePort: 3000,
			localPort: 3000,
			label: null,
			autoDetected: false,
			enabled: true,
			position: 0,
		},
		{
			id: "b",
			remotePort: 5173,
			localPort: 5173,
			label: null,
			autoDetected: false,
			enabled: true,
			position: 1,
		},
	],
	detectedPorts: [
		{ port: 3000, processName: "node" },
		{ port: 5173, processName: "vite" },
	],
	error: null,
	...overrides,
});

describe("CLOUD-10 Forwarding ports toast", () => {
	it("lists the local ports and their process names", () => {
		expect(forwardingToast(view())).toEqual({
			title: "Forwarding ports",
			description: ":3000 node, :5173 vite",
		});
	});

	it("lists at most three and counts the rest", () => {
		const many = view({
			forwards: [
				{
					id: "a",
					remotePort: 3000,
					localPort: 3000,
					label: null,
					autoDetected: false,
					enabled: true,
					position: 0,
				},
				{
					id: "b",
					remotePort: 3001,
					localPort: 3001,
					label: null,
					autoDetected: false,
					enabled: true,
					position: 0,
				},
				{
					id: "c",
					remotePort: 3002,
					localPort: 3002,
					label: null,
					autoDetected: false,
					enabled: true,
					position: 0,
				},
				{
					id: "d",
					remotePort: 3003,
					localPort: 3003,
					label: null,
					autoDetected: false,
					enabled: true,
					position: 0,
				},
			],
			detectedPorts: [],
		});
		expect(forwardingToast(many)?.description).toBe(":3000, :3001, :3002, +1 more");
	});

	it("shows nothing when no forward is on", () => {
		expect(forwardingToast(view({ forwards: [] }))).toBeNull();
		expect(
			forwardingToast(
				view({
					forwards: [
						{
							id: "a",
							remotePort: 3000,
							localPort: 3000,
							label: null,
							autoDetected: false,
							enabled: false,
							position: 0,
						},
					],
				}),
			),
		).toBeNull();
	});
});
