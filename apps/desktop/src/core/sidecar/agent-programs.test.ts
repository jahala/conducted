import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { type AgentPrograms, chosenAgentPrograms, followAgentPrograms } from "./agent-programs.ts";

/** A follower over listeners the test fires itself; `answers` decides each send's outcome. */
function follower(programs: () => AgentPrograms, answers: Result<void>[] = []) {
	let settingsListener: () => void = () => {};
	let reconnectListener: () => void = () => {};
	const sent: AgentPrograms[] = [];
	const logged: string[] = [];
	const stop = followAgentPrograms({
		programs,
		onSettingsChanged: (listener) => {
			settingsListener = listener;
			return () => {
				settingsListener = () => {};
			};
		},
		onReconnected: (listener) => {
			reconnectListener = listener;
			return () => {
				reconnectListener = () => {};
			};
		},
		send: async (params) => {
			sent.push(params.programs);
			return answers.shift() ?? ok(undefined);
		},
		log: (message) => logged.push(message),
	});
	return {
		sent,
		logged,
		stop,
		settingsChanged: () => settingsListener(),
		reconnected: () => reconnectListener(),
	};
}

const claude: AgentPrograms = [{ agent: "claude", path: "/opt/claude" }];

describe("SIDE-21 following the chosen agent programs", () => {
	it("lists only the agents with a path, trimmed, the two ACP agents apart", () => {
		const paths: Record<string, string> = {
			claude: " /opt/claude ",
			codex: "",
			"acp:pi": "/opt/pi",
		};
		expect(
			chosenAgentPrograms(
				(agent, acpAgent) => paths[acpAgent ? `${agent}:${acpAgent}` : agent] ?? "",
			),
		).toEqual([
			{ agent: "claude", path: "/opt/claude" },
			{ agent: "acp", acpAgent: "pi", path: "/opt/pi" },
		]);
	});

	it("sends again after a reconnect even when nothing changed, and nothing for an unrelated change", async () => {
		const subject = follower(() => claude);
		subject.settingsChanged();
		expect(subject.sent).toEqual([claude]);

		subject.reconnected();
		expect(subject.sent).toEqual([claude, claude]);

		subject.stop();
		subject.reconnected();
		expect(subject.sent).toHaveLength(2);
	});

	it("logs a failed send, and the next settings change sends the same list again", async () => {
		const subject = follower(() => claude, [err(appError("sidecar_down", "The sidecar is down."))]);
		await vi.waitFor(() =>
			expect(subject.logged).toEqual([
				"Could not tell the sidecar the chosen agent programs: The sidecar is down.",
			]),
		);

		subject.settingsChanged();
		expect(subject.sent).toEqual([claude, claude]);
	});
});
