/**
 * Turns what one sidecar sent back during a scenario (a `SideRun` from diff.ts) into a neutral trace,
 * so two sidecars with different wire formats can be compared item by item.
 *
 * - `ordered`: the items that must agree, in the order they arrived. Answers to the app's calls
 *   (`answer <step> ok|error`, with the names of any slash commands or models listed), stored events (`user_message`, `agent ...`, `checkpoint <phase>`,
 *   `turn_end <outcome>`), status changes (`status working|idle`, kept only when the status is not
 *   the one last reported), the sidecar's questions to the app (`interaction <kind> ...`), errors and
 *   config changes.
 * - `background`: lines that do not belong to the scenario's calls, such as agent version reports
 *   and install lists. They are listed, not aligned.
 * - `answers`: per step, the answer's shape (its top-level keys, or the error), for the report.
 *
 * Agent output is described from the agent's own payload, which both sidecars keep (`rawPayload` in
 * Conductor's events, `raw` in ours): a Claude message by its type and content blocks, a Codex
 * notification by its event and item type. Ids, times and the seal's paths are replaced, so only
 * meaning is compared.
 *
 * `normaliseAgentLog` does the same for what each sidecar sent the fake agent: the probes it ran
 * (sorted, since they race), each agent session's flags, and every control request, message or call
 * it wrote to the agent, in order.
 */
import type { Json } from "./client.ts";
import type { Side } from "./launch.ts";

export interface Trace {
	ordered: string[];
	background: string[];
	answers: Record<string, string>;
}

interface RunLike {
	side: Side;
	received: { at: number; message: Json }[];
	sent: Json[];
}

const obj = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Replaces ids, temp paths and numbers that change from run to run. */
export function scrub(text: string): string {
	return text
		.replace(/\/(private\/)?tmp\/sdiff-[A-Za-z0-9_-]+/g, "<seal>")
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
		.replace(/\b\d{10,}\b/g, "<n>");
}

const STEP_OF: Record<Side, Record<string, string>> = {
	conductor: {
		query: "send",
		warmAgent: "warm",
		cancel: "cancel",
		getSessionStatus: "status",
		listCodexModels: "listModels",
		fetchSlashCommands: "listSlashCommands",
	},
	ours: {
		sendMessage: "send",
		warmAgent: "warm",
		cancel: "cancel",
		getSessionStatus: "status",
		listModels: "listModels",
		listSlashCommands: "listSlashCommands",
	},
};

/** A Claude SDK message as trace items. */
export function describeClaude(raw: Json): string[] {
	const type = str(raw.type);
	if (type === "system") return [`agent system/${str(raw.subtype)}`];
	if (type === "result") return [`agent result/${str(raw.subtype)} error=${raw.is_error === true}`];
	const content = obj(raw.message).content;
	if (type === "assistant" || type === "user") {
		const items: string[] = [];
		if (typeof content === "string") items.push(`agent ${type} text: ${content}`);
		for (const block of list(content)) {
			const b = obj(block);
			const kind = str(b.type);
			if (kind === "text") items.push(`agent ${type} text: ${str(b.text)}`);
			else if (kind === "tool_use") items.push(`agent tool_use ${str(b.name)}`);
			else if (kind === "tool_result")
				items.push(`agent tool_result ${b.is_error === true ? "error" : "ok"}`);
			else items.push(`agent ${type} ${kind}`);
		}
		if (typeof raw.error === "string") items.push(`agent assistant error=${raw.error}`);
		return items;
	}
	return [`agent ${type || "unknown"}`];
}

const flat = (name: string) => name.toLowerCase().replace(/[_]/g, "");

function codexItem(phase: string, item: Json): string {
	const text = phase === "completed" && str(item.text) !== "" ? ` text: ${str(item.text)}` : "";
	return `agent codex item.${phase} ${flat(str(item.type))}${text}`;
}

/**
 * A Codex event as trace items. Conductor keeps an SDK-style thread event (`{event, thread_id}`);
 * ours keeps the app-server item itself, or the token usage notification. Both sidecars' end of
 * turn with usage (`turn.completed` for Conductor, `thread/tokenUsage/updated` for ours) is
 * `agent codex usage`.
 */
export function describeCodex(raw: Json): string[] {
	const event = obj(raw.event);
	if (Object.keys(event).length > 0) {
		const type = str(event.type);
		if (type === "turn.completed") return ["agent codex usage"];
		if (type.startsWith("item.")) return [codexItem(type.slice("item.".length), obj(event.item))];
		return [`agent codex ${type}`];
	}
	if (raw.tokenUsage !== undefined) return ["agent codex usage"];
	if (typeof raw.type === "string")
		return [codexItem(str(raw.status) === "inProgress" ? "started" : "completed", raw)];
	return [`agent codex {${Object.keys(raw).sort().join(", ")}}`];
}

function describeAgentPayload(raw: Json, agentType: string): string[] {
	if (agentType === "codex" || raw.event !== undefined || typeof raw.method === "string")
		return describeCodex(raw);
	return describeClaude(raw);
}

function conductorItems(message: Json): { ordered: string[]; background: string[] } {
	const method = str(message.method);
	const p = obj(message.params);
	const ordered: string[] = [];
	const background: string[] = [];
	const event = obj(p.event);
	switch (method) {
		case "sessionEventNotification":
		case "deliverSessionEvent": {
			const prefix = method === "deliverSessionEvent" ? "replay " : "";
			const type = str(event.type);
			if (type === "userMessage") ordered.push(`${prefix}user_message`);
			else if (type === "agent")
				for (const item of describeAgentPayload(obj(event.rawPayload), str(p.agentType)))
					ordered.push(prefix + item);
			else if (type === "checkpointCreated")
				ordered.push(`${prefix}checkpoint ${str(event.checkpointType)}`);
			else ordered.push(`${prefix}event ${type}`);
			break;
		}
		case "sessionStatusNotification":
			ordered.push(`status ${str(p.status)}`);
			break;
		case "sessionStateNotification": {
			const live = obj(p.updatedLiveState);
			if (str(live.status) !== "") ordered.push(`status ${str(live.status)}`);
			if (p.updatedConfig !== undefined) ordered.push("config_state");
			break;
		}
		case "queryError":
			ordered.push("error");
			break;
		case "enterPlanModeNotification":
			ordered.push("config_changed entered_plan_mode");
			break;
		case "toolApproval":
			ordered.push(`interaction tool_approval ${str(p.toolName)}`);
			break;
		case "exitPlanMode":
			ordered.push("interaction plan_approval");
			break;
		case "askUserQuestion":
			ordered.push("interaction question");
			break;
		case "codexPermissionApproval":
			ordered.push("interaction permission_grant");
			break;
		case "harnessVersionsNotification":
		case "keepAwake":
		case "shellEnvCaptureNotification":
			background.push(method);
			break;
		default:
			ordered.push(`notify ${method}`);
	}
	return { ordered, background };
}

function ourItems(message: Json): { ordered: string[]; background: string[] } {
	const method = str(message.method);
	const p = obj(message.params);
	const ordered: string[] = [];
	const background: string[] = [];
	switch (method) {
		case "sessionEvent":
		case "deliverEvent": {
			const prefix = method === "deliverEvent" ? "replay " : "";
			const event = obj(p.event);
			const type = str(event.type);
			if (type === "user_message") ordered.push(`${prefix}user_message`);
			else if (type === "agent") {
				const agentMessage = obj(event.message);
				const raw = obj(agentMessage.raw);
				if (Object.keys(raw).length > 0)
					for (const item of describeAgentPayload(raw, str(agentMessage.agent)))
						ordered.push(prefix + item);
				else
					for (const item of list(agentMessage.items))
						ordered.push(`${prefix}agent (no raw) ${str(obj(item).kind)}`);
			} else if (type === "checkpoint") ordered.push(`${prefix}checkpoint ${str(event.phase)}`);
			else if (type === "turn_ended") ordered.push(`${prefix}turn_end ${str(event.outcome)}`);
			else ordered.push(`${prefix}event ${type}`);
			break;
		}
		case "liveState":
			ordered.push(`status ${str(obj(p.liveState).status)}`);
			break;
		case "agentSessionId":
			ordered.push("agent_session_id");
			break;
		case "agentConfigChanged":
			ordered.push(`config_changed ${str(p.reason)}`);
			break;
		case "interactionClosed":
			ordered.push(`interaction_closed ${str(p.reason)}`);
			break;
		case "requestInteraction": {
			const interaction = obj(p.interaction);
			const kind = str(interaction.kind);
			ordered.push(
				kind === "tool_approval"
					? `interaction ${kind} ${str(interaction.toolName)}`
					: `interaction ${kind}`,
			);
			break;
		}
		case "agentInstallsChanged":
			background.push(method);
			break;
		default:
			ordered.push(`notify ${method}`);
	}
	return { ordered, background };
}

/** The names or ids in an answer's lists of slash commands or models, sorted. */
export function listedNames(result: unknown): string[] {
	const found: string[] = [];
	const visit = (value: unknown, key: string) => {
		if (Array.isArray(value)) {
			if (/^(commands|slashCommands|models)$/.test(key))
				for (const entry of value) {
					const e = obj(entry);
					const name = str(e.name) || str(e.id);
					if (name !== "") found.push(name);
				}
			return;
		}
		if (typeof value === "object" && value !== null)
			for (const [k, v] of Object.entries(value as Json)) visit(v, k);
	};
	visit(result, "");
	return found.sort();
}

function answerShape(message: Json): string {
	if (message.error !== undefined) {
		const error = obj(message.error);
		return `error ${String(error.code)} ${scrub(str(error.message))}`;
	}
	const result = message.result;
	if (result === null || result === undefined) return "null";
	if (typeof result !== "object") return typeof result;
	return `{${Object.keys(result as Json)
		.sort()
		.join(", ")}}`;
}

export function normaliseRun(run: RunLike): Trace {
	const ordered: string[] = [];
	const background: string[] = [];
	const answers: Record<string, string> = {};
	const sentById = new Map<unknown, Json>();
	for (const sent of run.sent)
		if (typeof sent.method === "string" && sent.id !== undefined) sentById.set(sent.id, sent);
	const seenSteps = new Map<string, number>();
	let lastStatus = "";
	const push = (item: string) => {
		const clean = scrub(item);
		if (clean.startsWith("status ")) {
			if (clean === lastStatus) return;
			lastStatus = clean;
		}
		ordered.push(clean);
	};
	for (const { message } of run.received) {
		const isResponse = message.method === undefined && message.id !== undefined;
		if (isResponse) {
			const request = sentById.get(message.id);
			const method = str(request?.method);
			const step = STEP_OF[run.side][method] ?? method;
			const count = (seenSteps.get(step) ?? 0) + 1;
			seenSteps.set(step, count);
			answers[count === 1 ? step : `${step} #${count}`] = answerShape(message);
			const names = message.error === undefined ? listedNames(message.result) : [];
			const listed = names.length > 0 ? ` [${names.join(", ")}]` : "";
			push(`answer ${step} ${message.error === undefined ? "ok" : "error"}${listed}`);
			continue;
		}
		const items = run.side === "conductor" ? conductorItems(message) : ourItems(message);
		for (const item of items.ordered) push(item);
		for (const item of items.background) background.push(scrub(item));
	}
	return { ordered, background, answers };
}

// ---------------------------------------------------------------- agent input

interface LogEntry {
	agent?: unknown;
	pid?: unknown;
	dir?: unknown;
	args?: unknown;
	line?: unknown;
}

function isSessionStart(args: string[]): boolean {
	return args.includes("--output-format") || args.includes("app-server");
}

/** "chat" for a process that runs a chat (it is given a session id), "aux" for a listing or probe. */
function processKind(agent: string, args: string[]): string {
	if (agent === "codex") return "codex";
	return args.some((arg) => arg.startsWith("--session-id") || arg.startsWith("--resume"))
		? "claude chat"
		: "claude aux";
}

function claudeInput(line: Json): string {
	const type = str(line.type);
	if (type === "control_request") return `control_request ${str(obj(line.request).subtype)}`;
	if (type === "control_response") {
		const response = obj(obj(line.response).response);
		const behaviour = str(response.behavior);
		return `control_response ${str(obj(line.response).subtype)}${behaviour ? ` ${behaviour}` : ""}`;
	}
	if (type === "user") {
		const content = obj(line.message).content;
		const text = typeof content === "string" ? content : JSON.stringify(content);
		const marker = /\[\[sdiff:([a-z-]+)\]\]/.exec(text)?.[1] ?? "none";
		return `user message (${marker})`;
	}
	return type || "unknown";
}

function codexInput(line: Json): string {
	const method = str(line.method);
	if (method === "") return line.error !== undefined ? "response error" : "response";
	return line.id === undefined ? `notify ${method}` : method;
}

export function normaliseAgentLog(entries: readonly Json[]): string[] {
	const probes: string[] = [];
	const sessions = new Map<unknown, string>();
	const counts = new Map<string, number>();
	const items: string[] = [];
	for (const raw of entries) {
		const entry = raw as LogEntry;
		const agent = str(entry.agent);
		if (entry.dir === "start") {
			const args = list(entry.args).map(String);
			if (!isSessionStart(args)) {
				probes.push(`probe ${agent} ${args.join(" ")}`);
				continue;
			}
			const kind = processKind(agent, args);
			const count = (counts.get(kind) ?? 0) + 1;
			counts.set(kind, count);
			const label = `${kind} ${count}`;
			sessions.set(entry.pid, label);
			const flags = args
				.filter((arg) => arg.startsWith("--"))
				.map((arg) => scrub(arg.length > 80 ? `${arg.slice(0, 80)}...` : arg))
				.sort();
			items.push(`${label} start`);
			for (const flag of flags) items.push(`${label} flag ${flag}`);
			continue;
		}
		if (entry.dir !== "in") continue;
		const session = sessions.get(entry.pid) ?? `${agent} ?`;
		let line: Json;
		try {
			line = JSON.parse(str(entry.line)) as Json;
		} catch {
			continue;
		}
		items.push(`${session} in ${agent === "codex" ? codexInput(line) : claudeInput(line)}`);
	}
	return [...probes.sort(), ...items];
}
