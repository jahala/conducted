// CLOUD-02 spike: 20 JSON-RPC round trips (getAgentInstalls) over the cloud path
// (Mac -> Worker -> Durable Object -> container -> sidecar). Usage: SPIKE_URL=<workers.dev URL> node driver/rtt.mjs <sandbox name>
import { readFileSync } from "node:fs";

const token = readFileSync("/tmp/conducted-spike-cloud/pairing-token", "utf8").trim();
const ws = new WebSocket(
	`${process.env.SPIKE_URL?.replace(/^http/, "ws")}/w/${process.argv[2]}/rpc`,
	{ headers: { authorization: `Bearer ${token}` } },
);
ws.binaryType = "arraybuffer";
const dec = new TextDecoder();
let buf = "";
const waits = new Map();
let id = 0;
ws.addEventListener("message", (e) => {
	buf += dec.decode(e.data, { stream: true });
	const lines = buf.split("\n");
	buf = lines.pop();
	for (const l of lines) {
		const m = JSON.parse(l);
		if (m.id !== undefined && !m.method) waits.get(m.id)?.();
	}
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const times = [];
for (let i = 0; i < 20; i++) {
	const n = ++id;
	const t = performance.now();
	await new Promise((r) => {
		waits.set(n, r);
		ws.send(
			JSON.stringify({ jsonrpc: "2.0", id: n, method: "getAgentInstalls", params: {} }) + "\n",
		);
	});
	times.push(Math.round(performance.now() - t));
}
ws.close();
times.sort((a, b) => a - b);
console.log(
	JSON.stringify({
		samples: times.length,
		minMs: times[0],
		medianMs: times[10],
		maxMs: times[19],
		all: times,
	}),
);
