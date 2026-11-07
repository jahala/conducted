/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: reading the sandbox's listening TCP ports and naming the process behind each one, from
 * `/proc/net/tcp{,6}` and the `/proc/<pid>/fd` links. The entry calls this for `GET /ports`.
 * Behaviour: services-map.md 5A.3.3 (discovery returns ports with the process behind them; the
 * desktop's popover shows "Ports detected" with that name). Conductor reads a multiplexed socket;
 * its cloud backend is not in the research, so the `/proc` method is ours (D002, D110).
 * Must handle: an empty or absent file (no ports); a listener without a matching process (the name
 * is null, never an invented one); a socket inode linked by more than one descriptor; a port that
 * appears in both tables (once, preferring a named process); a non-listening row (state other than
 * 0A); a truncated line.
 * Test first: the real /proc fixture's port 3456 matches inode 167859 and the process that owns it.
 */

export interface ListeningSocket {
	port: number;
	inode: number;
}

export interface ProcessSockets {
	pid: number;
	name: string;
	inodes: readonly number[];
}

export interface DetectedRemotePort {
	port: number;
	processName: string | null;
}

/** The listening sockets in one `/proc/net/tcp` or `/proc/net/tcp6` text. */
export function parseProcTcp(text: string): ListeningSocket[] {
	const sockets: ListeningSocket[] = [];
	for (const line of text.split("\n").slice(1)) {
		const columns = line.trim().split(/\s+/);
		if (columns.length < 10 || columns[3] !== "0A") continue;
		const local = columns[1];
		const inode = Number(columns[9]);
		if (local === undefined || !Number.isInteger(inode) || inode <= 0) continue;
		const hex = local.slice(local.lastIndexOf(":") + 1);
		const port = Number.parseInt(hex, 16);
		if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
		sockets.push({ port, inode });
	}
	return sockets;
}

/** The inode in a `/proc/<pid>/fd` link such as `socket:[167859]`, or null for anything else. */
export function socketInode(link: string): number | null {
	const match = /^socket:\[(\d+)\]$/.exec(link);
	if (match?.[1] === undefined) return null;
	const inode = Number(match[1]);
	return Number.isInteger(inode) && inode > 0 ? inode : null;
}

/**
 * One entry per port, with the name of the first process whose descriptor links to the socket.
 * A port listed twice keeps the named process when one exists.
 */
export function detectedPorts(
	listeners: readonly ListeningSocket[],
	processes: readonly ProcessSockets[],
): DetectedRemotePort[] {
	const nameByInode = new Map<number, string>();
	for (const process of processes) {
		for (const inode of process.inodes) {
			if (!nameByInode.has(inode)) nameByInode.set(inode, process.name);
		}
	}
	const byPort = new Map<number, DetectedRemotePort>();
	for (const listener of listeners) {
		const name = nameByInode.get(listener.inode) ?? null;
		const earlier = byPort.get(listener.port);
		if (earlier === undefined || (earlier.processName === null && name !== null)) {
			byPort.set(listener.port, { port: listener.port, processName: name });
		}
	}
	return [...byPort.values()].sort((left, right) => left.port - right.port);
}
