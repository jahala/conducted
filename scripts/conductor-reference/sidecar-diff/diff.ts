/**
 * The sidecar differential run: Conductor's sidecar and ours get the same scenario calls
 * (scenarios.ts, translated by adapters.ts) and the same fake agent (fake-agent.ts), each in its own
 * sealed setup (seal.ts, launch.ts), one scenario and one sidecar at a time. What each sends back is
 * normalised (normalise.ts) and compared in order (compare.ts).
 *
 * Output, all in the main checkout's git-ignored `.context/day/conductor-ref/sidecar-diff/`, because it
 * holds Conductor's program output:
 * - `<scenario>/<side>.raw.json`: every line each way on the socket, the answers, the agent's log and
 *   the sidecar's stderr
 * - `<scenario>/compare.json`: both normalised traces and their aligned difference
 * - `summary.json`: per scenario, whether both ran and how many items differ
 *
 * Usage: bun scripts/conductor-reference/sidecar-diff/diff.ts [scenario-id ...] [--out <dir>]
 * It exits 1 when the seal cannot be proven or a sidecar cannot start; differences are findings.
 * Quiet mode: it runs under `nice -n 19` when started so, and only one sidecar runs at any time.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../paths.ts";
import { ADAPTERS, type Adapter, type RunContext } from "./adapters.ts";
import { type Answer, type Json, SidecarClient } from "./client.ts";
import { type Alignment, alignTraces } from "./compare.ts";
import { type Running, type Side, startSidecar } from "./launch.ts";
import { normaliseAgentLog, normaliseRun, type Trace } from "./normalise.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { assertNoRealAgents, makeSeal, proveSealed, removeSeal } from "./seal.ts";

const TURN_END_MS = 20_000;
const CALL_MS = 20_000;
const QUIET_MS = 1_500;
const QUIET_MAX_MS = 10_000;

export interface StepRecord {
	step: string;
	method: string | undefined;
	sentAt: number;
	answeredAt?: number;
	answer?: Answer;
	note?: string;
}

export interface SideRun {
	side: Side;
	scenario: string;
	started: boolean;
	startError?: string;
	steps: StepRecord[];
	received: { at: number; message: Json }[];
	sent: Json[];
	requests: { method: string; params: unknown; answer: Answer }[];
	agentLog: Json[];
	stderr: string;
	exitCode: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function quiet(client: SidecarClient): Promise<void> {
	const until = Date.now() + QUIET_MAX_MS;
	let seen = client.received.length;
	let stillSince = Date.now();
	while (Date.now() < until) {
		await sleep(100);
		if (client.received.length !== seen) {
			seen = client.received.length;
			stillSince = Date.now();
		} else if (Date.now() - stillSince >= QUIET_MS) return;
	}
}

function bounded(promise: Promise<Answer>, ms: number): Promise<Answer | undefined> {
	return Promise.race([promise, sleep(ms).then(() => undefined)]);
}

async function runSide(side: Side, scenario: Scenario): Promise<SideRun> {
	const adapter: Adapter = ADAPTERS[side];
	const seal = makeSeal(side === "conductor" ? "c" : "o");
	const run: SideRun = {
		side,
		scenario: scenario.id,
		started: false,
		steps: [],
		received: [],
		sent: [],
		requests: [],
		agentLog: [],
		stderr: "",
		exitCode: null,
	};
	let sidecar: Running | undefined;
	let client: SidecarClient | undefined;
	try {
		sidecar = await startSidecar(side, seal);
		run.started = true;
		client = await SidecarClient.open(sidecar.socketPath);
		const open = client;
		open.onRequest = (method, params) => {
			const answer = adapter.answer(method, params, scenario);
			run.requests.push({ method, params, answer });
			return answer;
		};
		const acked = new Set<unknown>();
		const ackTimer = setInterval(() => {
			for (const { message } of open.received) {
				if (acked.has(message)) continue;
				acked.add(message);
				const ack = adapter.ack(message);
				if (ack !== undefined) open.notify(ack.method, ack.params);
			}
		}, 20);
		const ctx: RunContext = { seal, scenario, turn: 0, lastTurnId: undefined };
		const pendingSends: Promise<void>[] = [];
		let turnEndsWaited = 0;
		try {
			for (const step of scenario.steps) {
				if (step.do === "waitTurnEnd") {
					turnEndsWaited += 1;
					const wanted = turnEndsWaited;
					const record: StepRecord = { step: step.do, method: undefined, sentAt: Date.now() };
					run.steps.push(record);
					const deadline = Date.now() + TURN_END_MS;
					while (open.received.filter((r) => adapter.turnEnded(r.message)).length < wanted) {
						if (Date.now() > deadline) {
							record.note = `no turn end ${wanted} within ${TURN_END_MS} ms`;
							break;
						}
						await sleep(50);
					}
					await quiet(open);
					continue;
				}
				if (step.do === "waitText") {
					const record: StepRecord = {
						step: `${step.do} ${step.text}`,
						method: undefined,
						sentAt: Date.now(),
					};
					run.steps.push(record);
					const found = await open.waitFor(
						(m) => JSON.stringify(m).includes(step.text),
						TURN_END_MS,
					);
					if (found === undefined) record.note = `no line with "${step.text}"`;
					continue;
				}
				const call = adapter.call(step, ctx);
				const record: StepRecord = { step: step.do, method: call?.method, sentAt: Date.now() };
				run.steps.push(record);
				if (call === undefined) {
					record.note = "this sidecar has no call for the step";
					continue;
				}
				const answered = open.request(call.method, call.params).then((answer) => {
					record.answer = answer;
					record.answeredAt = Date.now();
				});
				if (step.do === "send") pendingSends.push(answered);
				else if (
					(await bounded(
						answered.then(() => ({ result: null })),
						CALL_MS,
					)) === undefined
				)
					record.note = `no answer within ${CALL_MS} ms`;
			}
			await bounded(
				Promise.all(pendingSends).then(() => ({ result: null })),
				CALL_MS,
			);
			await quiet(open);
		} finally {
			clearInterval(ackTimer);
		}
	} catch (cause) {
		run.startError = cause instanceof Error ? cause.message : String(cause);
	} finally {
		if (client !== undefined) {
			run.received = client.received;
			run.sent = client.sent;
			client.close();
		}
		if (sidecar !== undefined) {
			run.exitCode = await sidecar.stop();
			run.stderr = sidecar.stderr();
		}
		run.agentLog = readFileSync(seal.agentLog, "utf8")
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => JSON.parse(line) as Json);
		removeSeal(seal);
	}
	return run;
}

export interface ScenarioResult {
	scenario: string;
	title: string;
	traces: Record<Side, Trace>;
	agentInput: Record<Side, string[]>;
	alignment: Alignment;
	agentAlignment: Alignment;
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const outFlag = argv.indexOf("--out");
	const out =
		outFlag === -1 ? join(defaultPaths().reference, "sidecar-diff") : (argv[outFlag + 1] as string);
	const wanted = argv.filter((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--out");
	const scenarios =
		wanted.length === 0 ? SCENARIOS : SCENARIOS.filter((s) => wanted.includes(s.id));
	if (scenarios.length === 0) {
		process.stderr.write(`No scenario matches ${wanted.join(", ")}\n`);
		return 64;
	}
	assertNoRealAgents();
	const probe = makeSeal("p");
	let sealed: ReturnType<typeof proveSealed>;
	try {
		sealed = proveSealed(probe);
	} finally {
		removeSeal(probe);
	}
	mkdirSync(out, { recursive: true });
	const summary: Json[] = [];
	for (const scenario of scenarios) {
		const runs = {} as Record<Side, SideRun>;
		for (const side of ["conductor", "ours"] as const) {
			process.stdout.write(`${scenario.id}: ${side} ...`);
			runs[side] = await runSide(side, scenario);
			process.stdout.write(
				runs[side].started ? " done\n" : ` did not start: ${runs[side].startError}\n`,
			);
		}
		const dir = join(out, scenario.id);
		mkdirSync(dir, { recursive: true });
		for (const side of ["conductor", "ours"] as const)
			writeFileSync(join(dir, `${side}.raw.json`), `${JSON.stringify(runs[side], null, 2)}\n`);
		const traces = { conductor: normaliseRun(runs.conductor), ours: normaliseRun(runs.ours) };
		const agentInput = {
			conductor: normaliseAgentLog(runs.conductor.agentLog),
			ours: normaliseAgentLog(runs.ours.agentLog),
		};
		const result: ScenarioResult = {
			scenario: scenario.id,
			title: scenario.title,
			traces,
			agentInput,
			alignment: alignTraces(traces.conductor.ordered, traces.ours.ordered),
			agentAlignment: alignTraces(agentInput.conductor, agentInput.ours),
		};
		writeFileSync(join(dir, "compare.json"), `${JSON.stringify(result, null, 2)}\n`);
		summary.push({
			scenario: scenario.id,
			started: { conductor: runs.conductor.started, ours: runs.ours.started },
			startErrors: { conductor: runs.conductor.startError, ours: runs.ours.startError },
			notes: Object.fromEntries(
				(["conductor", "ours"] as const).map((side) => [
					side,
					runs[side].steps.filter((s) => s.note !== undefined).map((s) => `${s.step}: ${s.note}`),
				]),
			),
			differences: result.alignment.differences,
			agentDifferences: result.agentAlignment.differences,
		});
	}
	writeFileSync(join(out, "summary.json"), `${JSON.stringify({ sealed, summary }, null, 2)}\n`);
	process.stdout.write(`Wrote ${out}\n`);
	return summary.every((s) => {
		const started = s.started as Record<Side, boolean>;
		return started.conductor && started.ours;
	})
		? 0
		: 1;
}

if (import.meta.main) process.exit(await main());
