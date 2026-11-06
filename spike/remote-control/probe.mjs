// Remote Control spike, path A5: as A3, plus an approval callback like the sidecar's (canUseTool).
// Logs each approval the CLI asks this host for, and whether an answer from claude.ai settles it
// first (the request's signal aborts). Unanswered here, a request is denied after 120 s.
import { query } from "@anthropic-ai/claude-agent-sdk";

const HOLD_MS = Number(process.env.HOLD_MS ?? 1200000);
let release;
const held = new Promise((r) => (release = r));
async function* input() {
	yield {
		type: "user",
		message: { role: "user", content: "Reply with the single word ready." },
		parent_tool_use_id: null,
		session_id: "",
	};
	await held;
}
const canUseTool = (toolName, toolInput, { signal }) =>
	new Promise((resolve) => {
		const asked = Date.now();
		console.log("PERMISSION_REQUEST", toolName, JSON.stringify(toolInput).slice(0, 200));
		const timer = setTimeout(() => {
			console.log("PERMISSION_TIMEOUT_DENY", toolName);
			resolve({ behavior: "deny", message: "No answer on the Mac within 120 s." });
		}, 120000);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			console.log("PERMISSION_ABORTED_AFTER_MS", Date.now() - asked, toolName);
			resolve({ behavior: "deny", message: "aborted" });
		});
	});
const q = query({
	prompt: input(),
	options: { cwd: "/tmp", permissionMode: "default", canUseTool },
});
let enabled = false;
setTimeout(() => release(), HOLD_MS);
for await (const m of q) {
	const s = JSON.stringify(m);
	if (m.type === "system" && m.subtype === "init" && !enabled) {
		enabled = true;
		q.enableRemoteControl(true, "Conducted Remote Control test 2").then(
			(r) => console.log("ENABLE_RESPONSE", JSON.stringify(r)),
			(e) => console.log("ENABLE_ERROR", String(e?.message ?? e)),
		);
	}
	if (m.type === "assistant") console.log("assistant", s.slice(0, 400));
	else console.log(m.type, m.subtype ?? "", s.length > 600 ? `${s.slice(0, 600)}…` : s);
}
console.log("ENDED");
