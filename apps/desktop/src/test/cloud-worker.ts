/**
 * @feature test support A scripted Worker for cloud workspace tests
 * Owns: answering a test container's Worker requests the way the user's Worker does, with one
 * sandbox per workspace name: the readiness check, start, state, the git and exec routes and the
 * file operations, plus the JSON-RPC requests sent over a workspace's sidecar relay.
 * Behaviour: not applicable, test support only. The routes and answer shapes are the Worker's
 * (apps/cloud/src/index.ts, front-door.ts, readiness.ts, workspace.ts).
 * Must handle: each sandbox keeps its own folders and files; `git clone` into a folder makes its
 * `.git/info/exclude` as git's template does; the runner's leading `-c` options are not part of
 * what a test reads; a relay request with no id (a notification) gets no answer.
 * Test first: not applicable; the CLOUD-19 create and journey tests use it.
 */
import { ok } from "@conducted/shared";
import type { CloudReadiness } from "../core/organization.ts";
import type { CloudRelay, CloudRequest } from "../platform/platform.ts";
import type { TestContainer } from "./container.ts";

/** One git call a sandbox received, without the runner's `-c` options. */
export interface WorkerGitCall {
	vmId: string;
	args: readonly string[];
	cwd: string;
}

/** One JSON-RPC request the app sent over a workspace's relay. */
export interface RelayCall {
	vmId: string;
	id: number;
	method: string;
	params: Record<string, unknown>;
}

export interface ScriptedWorker {
	readonly requests: CloudRequest[];
	readonly gitCalls: WorkerGitCall[];
	readonly relayCalls: RelayCall[];
	/** The workspace names whose sandbox was asked to start. */
	readonly started: string[];
	/** Makes the next `start` of any sandbox fail as an unreachable Worker does. */
	failNextStart(): void;
}

export const READY_WORKER: CloudReadiness = {
	github: true,
	agents: { anthropic: true, openai: false, cursor: false },
};

interface Sandbox {
	folders: Set<string>;
	files: Map<string, string>;
	branch: Map<string, string>;
}

const json = (body: unknown) => ok({ status: 200, body: JSON.stringify(body) });

/** The arguments without the runner's leading `-c key=value` pairs. */
function plainArgs(args: readonly string[]): readonly string[] {
	let index = 0;
	while (args[index] === "-c") index += 2;
	return args.slice(index);
}

/**
 * Scripts the container's Worker. `readiness` is what `/readiness` answers; `answerRelay` gives a
 * relay request's result (by default a sendMessage is delivered as a new turn and anything else
 * gets an empty result).
 */
export function scriptWorker(
	test: TestContainer,
	options: {
		readiness?: CloudReadiness;
		answerRelay?: (call: RelayCall) => unknown;
	} = {},
): ScriptedWorker {
	const readiness = options.readiness ?? READY_WORKER;
	const answerRelay =
		options.answerRelay ??
		((call: RelayCall) =>
			call.method === "sendMessage"
				? { deliveredAs: "new_turn" }
				: call.method === "listModels"
					? { models: [] }
					: {});
	const sandboxes = new Map<string, Sandbox>();
	const sandbox = (vmId: string): Sandbox => {
		let found = sandboxes.get(vmId);
		if (found === undefined) {
			found = { folders: new Set(["/workspace"]), files: new Map(), branch: new Map() };
			sandboxes.set(vmId, found);
		}
		return found;
	};
	const worker: ScriptedWorker & { failStart: boolean } = {
		requests: [],
		gitCalls: [],
		relayCalls: [],
		started: [],
		failStart: false,
		failNextStart() {
			worker.failStart = true;
		},
	};

	test.memory.controls.scriptCloud((request) => {
		worker.requests.push(request);
		if (request.path === "/readiness") return json(readiness);
		if (request.path === "/settings" && request.method === "GET") {
			return json({ gitIdentity: null, envVars: {} });
		}
		const match = /^\/w\/([^/]+)\/([a-z-]+)$/.exec(request.path);
		if (match === null) return null;
		const [, vmId = "", action] = match;
		const box = sandbox(vmId);
		switch (action) {
			case "start":
				if (worker.failStart) {
					worker.failStart = false;
					return ok({ status: 500, body: JSON.stringify({ error: "The Worker is down" }) });
				}
				worker.started.push(vmId);
				return json({ started: true, readyMs: 12, health: { ok: true }, instance: "basic" });
			case "state":
				return json({
					running: true,
					turnActive: false,
					alarmAt: null,
					instance: "basic",
					backups: [],
					resources: null,
				});
			case "exec":
				return json({ exitCode: 0, stdout: "", stderr: "" });
			case "git": {
				const body = request.body as { args: string[]; cwd: string };
				const args = plainArgs(body.args);
				worker.gitCalls.push({ vmId, args, cwd: body.cwd });
				return json(gitAnswer(box, args, body.cwd));
			}
			case "files":
				return json(
					fileAnswer(box, request.body as { operation: string; path: string; text?: string }),
				);
		}
		return null;
	});

	const cloud = test.memory.platform.cloud;
	const openRelay = cloud.openRelay.bind(cloud);
	cloud.openRelay = async (input) => {
		const opened = await openRelay(input);
		if (!opened.ok || (input.channel ?? "rpc") !== "rpc") return opened;
		const relay: CloudRelay = opened.value;
		const send = relay.send.bind(relay);
		relay.send = async (line) => {
			const sent = await send(line);
			const parsed = JSON.parse(line) as {
				id?: number;
				method?: string;
				params?: Record<string, unknown>;
			};
			if (parsed.id !== undefined && parsed.method !== undefined) {
				const call: RelayCall = {
					vmId: input.vmId,
					id: parsed.id,
					method: parsed.method,
					params: parsed.params ?? {},
				};
				worker.relayCalls.push(call);
				const result = answerRelay(call);
				queueMicrotask(() =>
					test.memory.controls.emitCloudLine(
						relay.id,
						`${JSON.stringify({ jsonrpc: "2.0", id: call.id, result })}\n`,
					),
				);
			}
			return sent;
		};
		return opened;
	};
	return worker;
}

function gitAnswer(
	box: Sandbox,
	args: readonly string[],
	cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
	const done = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
	switch (args[0]) {
		case "clone": {
			if (!box.folders.has(cwd)) {
				return { exitCode: 128, stdout: "", stderr: `fatal: cannot chdir to ${cwd}` };
			}
			box.folders.add(`${cwd}/.git`);
			box.files.set(
				`${cwd}/.git/info/exclude`,
				"# git ls-files --others --exclude-from=.git/info/exclude\n",
			);
			box.files.set(`${cwd}/README.md`, "hello\n");
			box.branch.set(cwd, "main");
			return done();
		}
		case "checkout":
			if (args[1] === "-b" && args[2] !== undefined) box.branch.set(cwd, args[2]);
			return done();
		case "branch":
			return done(args[1] === "--show-current" ? `${box.branch.get(cwd) ?? ""}\n` : "");
		case "rev-parse":
			if (args[1] === "--git-common-dir") return done(".git\n");
			return done("0123456789abcdef0123456789abcdef01234567\n");
		case "ls-files":
			return done(box.files.has(`${cwd}/README.md`) ? "README.md\n" : "");
		default:
			return done();
	}
}

function fileAnswer(
	box: Sandbox,
	body: { operation: string; path: string; text?: string },
): unknown {
	switch (body.operation) {
		case "exists":
			return { exists: box.folders.has(body.path) || box.files.has(body.path) };
		case "mkdirp": {
			const parts = body.path.split("/").filter((part) => part !== "");
			for (let end = 1; end <= parts.length; end++)
				box.folders.add(`/${parts.slice(0, end).join("/")}`);
			return {};
		}
		case "read":
			return { text: box.files.get(body.path) ?? "" };
		case "write":
			box.files.set(body.path, body.text ?? "");
			return {};
		case "readDir":
		case "list":
			return { entries: [], truncated: false };
		default:
			return {};
	}
}
