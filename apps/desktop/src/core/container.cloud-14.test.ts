// @vitest-environment node
/**
 * @feature CLOUD-14 Cloud agents ask to run commands on the Mac
 * Owns: proof through the real container that a cloud chat's RunLocalCommand request shows the
 * approval card, runs on the Mac after the answer, and answers the sidecar.
 * Behaviour: research/conductor/claude-runner.md section 4.2 (the app approves and runs the
 * command) and ui-map.md 3.3 ("...on your Mac?").
 * Test first: a request shows the card, and Allow runs the command on the Mac and answers.
 */
import {
	type Host,
	type InteractionAnswer,
	idleLiveState,
	type SessionConfig,
} from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: {
		diffComments: true,
		progressUpdates: true,
		setTargetBranch: true,
		localExecution: true,
	},
};

/** A card the agent in the sandbox opens through the sidecar. */
const BASH_CARD = {
	kind: "tool_approval",
	toolUseId: "tool-bash",
	toolName: "Bash",
	input: { command: "ls" },
} as const;

const isMacCard = (interaction: unknown): boolean =>
	(interaction as { toolName?: string } | undefined)?.toolName ===
	"mcp__conducted__RunLocalCommand";

/** Waits for a condition, and fails the test rather than hanging when it never holds. */
async function waitFor(what: string, check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 500; attempt++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${what}`);
}

async function readyCloudWorkspace(test: TestContainer) {
	const workspace = await seedWorkspace(test.container, { host: CLOUD, path: "/workspace" });
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	return workspace;
}

/**
 * Opens the cloud workspace's sidecar tunnel the way a chat does, by sending a message, and
 * returns a line writer and reader for that tunnel's relay.
 */
async function cloudRelay(test: TestContainer, sessionId: string) {
	const cloud = test.memory.controls;
	const sending = test.container.services.sessions.send(sessionId as never, "hello", [], "auto");
	await waitFor("the cloud relay", () =>
		cloud.cloudSent.some((sent) => sent.line.includes('"sendMessage"')),
	);
	const first = cloud.cloudSent.find((sent) => sent.line.includes('"sendMessage"'));
	if (first === undefined) throw new Error("no relay");
	const { id } = JSON.parse(first.line) as { id: number };
	cloud.emitCloudLine(
		first.relayId,
		`${JSON.stringify({ jsonrpc: "2.0", id, result: { deliveredAs: "new_turn" } })}\n`,
	);
	await sending;
	return {
		emit: (message: unknown) => cloud.emitCloudLine(first.relayId, `${JSON.stringify(message)}\n`),
		answered: (requestId: number) =>
			cloud.cloudSent
				.filter((sent) => sent.relayId === first.relayId)
				.map((sent) => sent.line)
				.find((line) => line.includes(`"id":${requestId}`) && line.includes('"result"')),
	};
}

describe("CLOUD-14 RunLocalCommand through the real container", () => {
	it("a request shows the card, and Allow runs the command on the Mac and answers", async () => {
		const test = createTestContainer();
		try {
			await test.container.sidecar.start();
			const seeded = await readyCloudWorkspace(test);
			const session = await test.container.services.sessions.create(seeded.id, CONFIG);
			if (!session.ok) throw new Error(session.error.message);

			test.memory.controls.scriptShell((command) =>
				command.program === "/bin/bash"
					? ok({ exitCode: 0, stdout: "from the mac\n", stderr: "" })
					: null,
			);

			const relay = await cloudRelay(test, session.value.id);
			relay.emit({
				jsonrpc: "2.0",
				id: 7,
				method: "runLocalCommand",
				params: { sessionId: session.value.id, command: "echo from the mac" },
			});

			await waitFor(
				"the approval card",
				() =>
					test.container.services.sessions.store.getState().openInteractions[session.value.id] !==
					undefined,
			);
			const open =
				test.container.services.sessions.store.getState().openInteractions[session.value.id];
			if (open === undefined) throw new Error("no card");
			expect(open.interaction.kind).toBe("tool_approval");
			if (open.interaction.kind === "tool_approval") {
				expect(open.interaction.toolName).toBe("mcp__conducted__RunLocalCommand");
			}
			expect(test.memory.controls.notificationsShown.at(-1)?.body).toBe(
				"Approve local command: echo from the mac",
			);

			// A live state the sidecar sends while the card is open carries no interaction; it must
			// not take the app's own card away.
			relay.emit({
				jsonrpc: "2.0",
				method: "liveState",
				params: {
					sessionId: session.value.id,
					liveState: { ...idleLiveState, status: "working" },
				},
			});
			await waitFor(
				"the sidecar's live state",
				() =>
					test.container.services.sessions.store.getState().liveStates[session.value.id]?.status ===
					"working",
			);
			expect(
				test.container.services.sessions.store.getState().openInteractions[session.value.id],
			).toBeDefined();

			const answer: InteractionAnswer = { kind: "tool_approval", decision: "allow" };
			const answered = await test.container.services.sessions.answer(
				session.value.id,
				open.interactionId,
				answer,
			);
			expect(answered.ok).toBe(true);

			await waitFor("the sidecar's answer", () => relay.answered(7) !== undefined);
			const parsed = JSON.parse(relay.answered(7) ?? "{}") as {
				result?: { code?: number; stdout?: string; cwd?: string };
			};
			expect(parsed.result?.code).toBe(0);
			expect(parsed.result?.stdout).toBe("from the mac\n");
			expect(parsed.result?.cwd).toBe(test.memory.platform.fs.paths.home);

			expect(
				test.memory.controls.shellCalls.some(
					(call) =>
						call.program === "/bin/bash" &&
						call.args[0] === "-lc" &&
						call.args[1] === "echo from the mac",
				),
			).toBe(true);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("Yes always turns on the setting, so the next command asks nothing", async () => {
		const test = createTestContainer();
		try {
			await test.container.sidecar.start();
			const seeded = await readyCloudWorkspace(test);
			const session = await test.container.services.sessions.create(seeded.id, CONFIG);
			if (!session.ok) throw new Error(session.error.message);
			test.memory.controls.scriptShell((command) =>
				command.program === "/bin/bash" ? ok({ exitCode: 0, stdout: "", stderr: "" }) : null,
			);

			const relay = await cloudRelay(test, session.value.id);
			const send = (id: number) =>
				relay.emit({
					jsonrpc: "2.0",
					id,
					method: "runLocalCommand",
					params: { sessionId: session.value.id, command: "whoami" },
				});

			send(8);
			await waitFor(
				"the first card",
				() =>
					test.container.services.sessions.store.getState().openInteractions[session.value.id] !==
					undefined,
			);
			const open =
				test.container.services.sessions.store.getState().openInteractions[session.value.id];
			if (open === undefined) throw new Error("no card");
			await test.container.services.sessions.answer(session.value.id, open.interactionId, {
				kind: "tool_approval",
				decision: "always_allow",
			});
			await waitFor("the first answer", () => relay.answered(8) !== undefined);
			expect(test.container.services.settings.get<boolean>("always_allow_local_execution")).toBe(
				true,
			);

			send(9);
			await waitFor("the second answer", () => relay.answered(9) !== undefined);
			expect(
				test.container.services.sessions.store.getState().openInteractions[session.value.id],
			).toBeUndefined();
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
	it("the same request over the Mac's own sidecar is refused, with no card", async () => {
		const test = createTestContainer();
		try {
			await test.container.sidecar.start();
			const seeded = await readyCloudWorkspace(test);
			const session = await test.container.services.sessions.create(seeded.id, CONFIG);
			if (!session.ok) throw new Error(session.error.message);

			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 10,
					method: "runLocalCommand",
					params: { sessionId: session.value.id, command: "whoami" },
				}),
			);
			await waitFor("the refusal", () =>
				test.memory.controls.sidecarSent.some((line) => line.includes('"id":10')),
			);
			const sent = test.memory.controls.sidecarSent.find((line) => line.includes('"id":10'));
			const parsed = JSON.parse(sent ?? "{}") as { result?: { denied?: boolean } };
			expect(parsed.result?.denied).toBe(true);
			expect(
				test.container.services.sessions.store.getState().openInteractions[session.value.id],
			).toBeUndefined();
			expect(test.memory.controls.shellCalls.some((call) => call.program === "/bin/bash")).toBe(
				false,
			);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
	it("the Mac's card covers the agent's open card, which comes back when it closes", async () => {
		const test = createTestContainer();
		try {
			await test.container.sidecar.start();
			const seeded = await readyCloudWorkspace(test);
			const session = await test.container.services.sessions.create(seeded.id, CONFIG);
			if (!session.ok) throw new Error(session.error.message);
			test.memory.controls.scriptShell((command) =>
				command.program === "/bin/bash" ? ok({ exitCode: 0, stdout: "", stderr: "" }) : null,
			);
			const relay = await cloudRelay(test, session.value.id);
			const openCard = () =>
				test.container.services.sessions.store.getState().openInteractions[session.value.id];

			relay.emit({
				jsonrpc: "2.0",
				id: 30,
				method: "requestInteraction",
				params: { sessionId: session.value.id, interactionId: "bash-1", interaction: BASH_CARD },
			});
			await waitFor("the agent's card", () => openCard()?.interactionId === "bash-1");

			relay.emit({
				jsonrpc: "2.0",
				id: 31,
				method: "runLocalCommand",
				params: { sessionId: session.value.id, command: "whoami" },
			});
			await waitFor("the Mac's card", () => isMacCard(openCard()?.interaction));
			expect(relay.answered(30)).toBeUndefined();

			const mac = openCard();
			if (mac === undefined) throw new Error("no card");
			await test.container.services.sessions.answer(session.value.id, mac.interactionId, {
				kind: "tool_approval",
				decision: "allow",
			});
			await waitFor("the command's answer", () => relay.answered(31) !== undefined);
			expect(openCard()?.interactionId).toBe("bash-1");
			expect(relay.answered(30)).toBeUndefined();
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("an agent's card that arrives under the Mac's card waits, then shows", async () => {
		const test = createTestContainer();
		try {
			await test.container.sidecar.start();
			const seeded = await readyCloudWorkspace(test);
			const session = await test.container.services.sessions.create(seeded.id, CONFIG);
			if (!session.ok) throw new Error(session.error.message);
			test.memory.controls.scriptShell((command) =>
				command.program === "/bin/bash" ? ok({ exitCode: 0, stdout: "mac\n", stderr: "" }) : null,
			);
			const relay = await cloudRelay(test, session.value.id);
			const openCard = () =>
				test.container.services.sessions.store.getState().openInteractions[session.value.id];

			relay.emit({
				jsonrpc: "2.0",
				id: 40,
				method: "runLocalCommand",
				params: { sessionId: session.value.id, command: "whoami" },
			});
			await waitFor("the Mac's card", () => isMacCard(openCard()?.interaction));
			const mac = openCard();
			if (mac === undefined) throw new Error("no card");

			relay.emit({
				jsonrpc: "2.0",
				id: 41,
				method: "requestInteraction",
				params: { sessionId: session.value.id, interactionId: "bash-2", interaction: BASH_CARD },
			});
			// The sidecar's live state follows its request; once it is shown, the request was handled.
			relay.emit({
				jsonrpc: "2.0",
				method: "liveState",
				params: {
					sessionId: session.value.id,
					liveState: {
						...idleLiveState,
						status: "working",
						openInteraction: { interactionId: "bash-2", interaction: BASH_CARD, since: 0 },
					},
				},
			});
			await waitFor(
				"the live state",
				() =>
					test.container.services.sessions.store.getState().liveStates[session.value.id]?.status ===
					"working",
			);
			expect(openCard()?.interactionId).toBe(mac.interactionId);
			expect(relay.answered(40)).toBeUndefined();
			expect(relay.answered(41)).toBeUndefined();

			await test.container.services.sessions.answer(session.value.id, mac.interactionId, {
				kind: "tool_approval",
				decision: "allow",
			});
			await waitFor("the command's answer", () => relay.answered(40) !== undefined);
			const parsed = JSON.parse(relay.answered(40) ?? "{}") as { result?: { stdout?: string } };
			expect(parsed.result?.stdout).toBe("mac\n");
			expect(openCard()?.interactionId).toBe("bash-2");
			expect(relay.answered(41)).toBeUndefined();
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
