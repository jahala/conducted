/**
 * @feature AGENT-11 ACP client and runner: method names
 * Owns: the ACP method names the client uses, as a plain table.
 * Behaviour: research/conductor/other-runners.md section 2.2: client to agent calls
 * `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/set_config_option`,
 * `session/set_mode`, `session/close` and the notification `session/cancel`; agent to client calls
 * `session/update` (notification), `session/request_permission`, `elicitation/create`,
 * `fs/read_text_file`, `fs/write_text_file`. The table is compared with the constants exported by
 * @agentclientprotocol/sdk in methods.test.ts, so a protocol change shows up as a failing test.
 * Must handle: nothing at runtime.
 * Test first: every value in this table equals the SDK constant of the same meaning.
 */
export const ACP_AGENT_METHODS = {
	initialize: "initialize",
	sessionNew: "session/new",
	sessionLoad: "session/load",
	sessionResume: "session/resume",
	sessionPrompt: "session/prompt",
	sessionCancel: "session/cancel",
	sessionSetConfigOption: "session/set_config_option",
	sessionSetMode: "session/set_mode",
	sessionClose: "session/close",
} as const;

export const ACP_CLIENT_METHODS = {
	sessionUpdate: "session/update",
	sessionRequestPermission: "session/request_permission",
	elicitationCreate: "elicitation/create",
	fsReadTextFile: "fs/read_text_file",
	fsWriteTextFile: "fs/write_text_file",
} as const;
