/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the pure rule that picks which local port a forward asks for: a manual mapping first, the
 * remote port under the "match" strategy, then a stable point inside the local range.
 * Behaviour: services-map.md 5A.3.3 (pinned mapping wins; "match" uses the remote port when it is
 * at least 1024, free and not a mapped local port; otherwise the range start is
 * `start + djb2(workspace) % rangeSize`). The Rust side then finds the first free port from that
 * preference, so this file never touches a socket.
 * Must handle: a pinned local port that is already taken is an error, never a silent move; an
 * invalid or out-of-range mapping line is skipped; port 22 is never chosen; a range whose ends are
 * reversed is refused; a remote port below 1024 never wins the match strategy.
 * Test first: a mapping 3000:4000 asks for 4000, and a taken 4000 is an error.
 */
import { appError, err, ok, type Result } from "@conducted/shared";

export interface PortMapping {
	remotePort: number;
	localPort: number;
}

export interface LocalRange {
	start: number;
	end: number;
}

export type ForwardingStrategy = "match" | "range";

/** The SSH port, which is never forwarded (ui-map.md 3.7). */
export const SSH_PORT = 22;
/** The lowest local port a forward may use. */
export const MIN_LOCAL_PORT = 1_024;
/** The highest local port. */
export const MAX_LOCAL_PORT = 65_535;

/** True for a number a forward may use as a remote port. */
export function isForwardablePort(port: number): boolean {
	return Number.isInteger(port) && port >= 1 && port <= MAX_LOCAL_PORT;
}

/** The validation message Conductor shows for a number that is not a port. */
export const INVALID_PORT_MESSAGE = "Enter a valid port (1-65535)";
/** The validation message Conductor shows for port 22. */
export const RESERVED_PORT_MESSAGE = "Port 22 is reserved for SSH and cannot be forwarded here";

/** Parses "remote:local" lines from the Connections page. Invalid lines are skipped. */
export function parseMappings(lines: readonly string[]): PortMapping[] {
	const mappings: PortMapping[] = [];
	for (const line of lines) {
		const match = /^\s*(\d{1,5})\s*:\s*(\d{1,5})\s*$/.exec(line);
		if (match === null) continue;
		const remotePort = Number(match[1]);
		const localPort = Number(match[2]);
		if (!isForwardablePort(remotePort) || remotePort === SSH_PORT) continue;
		if (!isForwardablePort(localPort) || localPort < MIN_LOCAL_PORT || localPort === SSH_PORT) {
			continue;
		}
		mappings.push({ remotePort, localPort });
	}
	return mappings;
}

/** djb2 with xor (5381, `h = h * 33 ^ c`), Conductor's stable spread across the range. */
export function djb2(text: string): number {
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		// >>> 0 keeps the unsigned 32-bit wraparound JavaScript numbers otherwise lose.
		hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
	}
	return hash;
}

export interface PortPlanInput {
	remotePort: number;
	workspaceKey: string;
	strategy: ForwardingStrategy;
	range: LocalRange;
	mappings: readonly PortMapping[];
	/** Local ports this machine already owns. */
	taken: ReadonlySet<number>;
}

export interface PortPlan {
	/** A manual mapping fixed the local port. */
	pinned: boolean;
	/** Where the Rust free-port search should start. */
	preferredPort: number | undefined;
}

/**
 * The local port a new forward asks for. A manual mapping is fixed and refuses a taken port; the
 * match strategy prefers the remote port when it is usable; otherwise the range gives a stable
 * starting point for the workspace.
 */
export function planLocalPort(input: PortPlanInput): Result<PortPlan> {
	const mapping = input.mappings.find((entry) => entry.remotePort === input.remotePort);
	if (mapping !== undefined) {
		if (input.taken.has(mapping.localPort)) {
			return err(
				appError(
					"port_forward_mapping_taken",
					`Local port ${mapping.localPort} is mapped to remote port ${input.remotePort} but is already in use`,
				),
			);
		}
		return ok({ pinned: true, preferredPort: mapping.localPort });
	}
	const start = Math.max(input.range.start, MIN_LOCAL_PORT);
	const end = Math.min(input.range.end, MAX_LOCAL_PORT);
	if (start > end) {
		return err(
			appError(
				"port_forward_range_invalid",
				"The local port range's first port is above its last.",
			),
		);
	}
	const mappedLocals = new Set(input.mappings.map((entry) => entry.localPort));
	const canMatch =
		input.strategy === "match" &&
		input.remotePort >= MIN_LOCAL_PORT &&
		input.remotePort !== SSH_PORT &&
		!mappedLocals.has(input.remotePort) &&
		!input.taken.has(input.remotePort);
	if (canMatch) return ok({ pinned: false, preferredPort: input.remotePort });
	const span = end - start + 1;
	const preferred = start + (djb2(input.workspaceKey) % span);
	return ok({ pinned: false, preferredPort: preferred });
}
