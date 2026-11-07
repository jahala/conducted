/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the /proc reader that names a listening port's process, using text captured from a real
 * Node process's /proc/net/tcp{,6} and cmdline.
 * Test first: the real fixture's port 3456 matches inode 172083 and its command line names server.js.
 */
import { describe, expect, it } from "vitest";
import { detectedPorts, parseProcTcp, processName, socketInode } from "./ports.ts";

/** Captured from `/proc/net/tcp` of a real Node process: `node /tmp/server.js` on 3456. */
const PROC_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0D80 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 172083 1 0000000000000000 100 0 0 10 0
`;

/** Captured from `/proc/net/tcp6` of the same process; Node bound the IPv4 stack only. */
const PROC_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
`;

const fixture = (name: string): string => (name === "proc-net-tcp.txt" ? PROC_TCP : PROC_TCP6);

describe("CLOUD-10 /proc port discovery", () => {
	it("reads the real fixture's listening port and inode", () => {
		expect(parseProcTcp(fixture("proc-net-tcp.txt"))).toEqual([{ port: 3456, inode: 172083 }]);
		expect(parseProcTcp(fixture("proc-net-tcp6.txt"))).toEqual([]);
	});

	it("names the process whose descriptor links to the socket", () => {
		const listeners = parseProcTcp(fixture("proc-net-tcp.txt"));
		// The real cmdline is `node\0/tmp/server.js\0`; Conductor shows the script's name.
		const command = ["node", "/tmp/server.js"];
		expect(
			detectedPorts(listeners, [
				{ pid: 8, name: processName(command), inodes: [172083] },
				{ pid: 9, name: "other", inodes: [1] },
			]),
		).toEqual([{ port: 3456, processName: "server.js" }]);
	});

	it("summarises a command line as Conductor does", () => {
		expect(processName(["node", "/tmp/server.js"])).toBe("server.js");
		expect(processName(["/usr/bin/node", "/x/server.js"])).toBe("server.js");
		expect(processName(["node", "/workspace/node_modules/.bin/vite", "--port", "3000"])).toBe(
			"vite",
		);
		expect(processName(["node", "/workspace/node_modules/@scope/tool/bin.js"])).toBe("@scope/tool");
		expect(processName(["bun", "run", "dev"])).toBe("bun dev");
		expect(processName(["pnpm", "dev"])).toBe("pnpm dev");
		expect(processName(["python3", "-m", "http.server", "8000"])).toBe("http.server");
		expect(processName(["/usr/bin/node server.js"])).toBe("node");
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
