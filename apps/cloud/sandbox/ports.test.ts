/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the /proc reader that names a listening port's process, using text captured from a real
 * Linux /proc/net/tcp{,6} in the product image.
 * Test first: the real fixture's port 3456 matches inode 167859 and the process that owns it.
 */
import { describe, expect, it } from "vitest";
import { detectedPorts, parseProcTcp, socketInode } from "./ports.ts";

/** Captured from `/proc/net/tcp` of the product image, where a node server listened on 3456. */
const PROC_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0D80 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 167859 1 0000000000000000 100 0 0 10 0
`;

/** Captured from `/proc/net/tcp6` of the same run; node bound both stacks. */
const PROC_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:0D80 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 167859 1 0000000000000000 100 0 0 10 0
`;

const fixture = (name: string): string => (name === "proc-net-tcp.txt" ? PROC_TCP : PROC_TCP6);

describe("CLOUD-10 /proc port discovery", () => {
	it("reads the real fixture's listening port and inode", () => {
		expect(parseProcTcp(fixture("proc-net-tcp.txt"))).toEqual([{ port: 3456, inode: 167859 }]);
		expect(parseProcTcp(fixture("proc-net-tcp6.txt"))).toEqual([{ port: 3456, inode: 167859 }]);
	});

	it("names the process whose descriptor links to the socket", () => {
		const listeners = parseProcTcp(fixture("proc-net-tcp.txt"));
		expect(
			detectedPorts(listeners, [
				{ pid: 8, name: "MainThread", inodes: [167859] },
				{ pid: 9, name: "other", inodes: [1] },
			]),
		).toEqual([{ port: 3456, processName: "MainThread" }]);
	});

	it("keeps a listener whose process is gone, with no invented name", () => {
		const listeners = parseProcTcp(fixture("proc-net-tcp.txt"));
		expect(detectedPorts(listeners, [])).toEqual([{ port: 3456, processName: null }]);
	});

	it("lists a port once, preferring a named process over an unnamed one", () => {
		const listeners = [
			{ port: 3000, inode: 1 },
			{ port: 3000, inode: 2 },
		];
		expect(detectedPorts(listeners, [{ pid: 1, name: "node", inodes: [2] }])).toEqual([
			{ port: 3000, processName: "node" },
		]);
	});

	it("ignores non-listening rows and short lines", () => {
		const text = [
			"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
			"   0: 0100007F:0D80 0100007F:9999 01 00000000:00000000 00:00000000 00000000     0        0 167859",
			"   1: broken",
		].join("\n");
		expect(parseProcTcp(text)).toEqual([]);
	});

	it("parses only socket descriptors", () => {
		expect(socketInode("socket:[167859]")).toBe(167859);
		expect(socketInode("pipe:[12]")).toBeNull();
		expect(socketInode("/dev/null")).toBeNull();
		expect(socketInode("socket:[nope]")).toBeNull();
	});
});
