/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: telling the sidecar which agent programs the user chose in Settings (`setAgentPrograms`),
 * so its agent list (the Agents page, `agentInstallsChanged`) reports those programs.
 * Behaviour: other-runners.md 5 (the agent detector gets the Settings program paths);
 * native-and-sidecar-map.md B3 (versions are probed again when the paths change).
 * Must handle: the first send once the sidecar is up, a send after every reconnect (a restarted
 * sidecar keeps nothing), a send only when a path really changed (settings change often), a
 * cleared path (left out of the list), and a send that fails (logged, and the next change or
 * reconnect sends again).
 * Test first: agent-programs.container.side-21.test.ts, "sends the chosen program paths once the
 * sidecar is up, and again when one changes".
 */
import type { AcpAgent, AgentKind, Result } from "@conducted/shared";
import type { AppToSidecarNotificationParams } from "./tunnel.ts";

export type AgentPrograms = AppToSidecarNotificationParams<"setAgentPrograms">["programs"];

/** Every agent program the app knows, in the order the list is sent. */
const AGENTS: readonly { agent: AgentKind; acpAgent?: AcpAgent }[] = [
	{ agent: "claude" },
	{ agent: "codex" },
	{ agent: "cursor" },
	{ agent: "acp", acpAgent: "opencode" },
	{ agent: "acp", acpAgent: "pi" },
];

/** The programs chosen in Settings: each agent with a program path setting that is not empty. */
export function chosenAgentPrograms(
	pathOf: (agent: AgentKind, acpAgent?: AcpAgent) => string,
): AgentPrograms {
	const programs: AgentPrograms = [];
	for (const selector of AGENTS) {
		const path = pathOf(selector.agent, selector.acpAgent).trim();
		if (path !== "") programs.push({ ...selector, path });
	}
	return programs;
}

export interface FollowAgentProgramsDeps {
	/** The programs chosen now. */
	programs(): AgentPrograms;
	/** Calls back on every settings change. */
	onSettingsChanged(listener: () => void): () => void;
	/** Calls back once a restarted sidecar is connected again. */
	onReconnected(listener: () => void): () => void;
	send(params: { programs: AgentPrograms }): Promise<Result<void>>;
	log(message: string): void;
}

/**
 * Sends the chosen programs now, after every reconnect, and whenever they change. Returns the
 * function that stops following.
 */
export function followAgentPrograms(deps: FollowAgentProgramsDeps): () => void {
	let sent: string | null = null;
	const send = (always: boolean): void => {
		const programs = deps.programs();
		const signature = JSON.stringify(programs);
		if (!always && signature === sent) return;
		sent = signature;
		void deps.send({ programs }).then((result) => {
			if (result.ok) return;
			// The next change or reconnect sends the list again.
			if (sent === signature) sent = null;
			deps.log(`Could not tell the sidecar the chosen agent programs: ${result.error.message}`);
		});
	};
	const stopSettings = deps.onSettingsChanged(() => send(false));
	const stopReconnect = deps.onReconnected(() => send(true));
	send(true);
	return () => {
		stopSettings();
		stopReconnect();
	};
}
