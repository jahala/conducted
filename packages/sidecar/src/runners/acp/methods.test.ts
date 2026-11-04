import { expect, test } from "bun:test";
import { AGENT_METHODS, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { ACP_AGENT_METHODS, ACP_CLIENT_METHODS } from "./methods.ts";

test("our method names equal the SDK's constants", () => {
	expect(ACP_AGENT_METHODS.initialize).toBe(AGENT_METHODS.initialize);
	expect(ACP_AGENT_METHODS.sessionNew).toBe(AGENT_METHODS.session_new);
	expect(ACP_AGENT_METHODS.sessionLoad).toBe(AGENT_METHODS.session_load);
	expect(ACP_AGENT_METHODS.sessionResume).toBe(AGENT_METHODS.session_resume);
	expect(ACP_AGENT_METHODS.sessionPrompt).toBe(AGENT_METHODS.session_prompt);
	expect(ACP_AGENT_METHODS.sessionCancel).toBe(AGENT_METHODS.session_cancel);
	expect(ACP_AGENT_METHODS.sessionSetConfigOption).toBe(AGENT_METHODS.session_set_config_option);
	expect(ACP_AGENT_METHODS.sessionSetMode).toBe(AGENT_METHODS.session_set_mode);
	expect(ACP_AGENT_METHODS.sessionClose).toBe(AGENT_METHODS.session_close);
	expect(ACP_CLIENT_METHODS.sessionUpdate).toBe(CLIENT_METHODS.session_update);
	expect(ACP_CLIENT_METHODS.sessionRequestPermission).toBe(
		CLIENT_METHODS.session_request_permission,
	);
	expect(ACP_CLIENT_METHODS.elicitationCreate).toBe(CLIENT_METHODS.elicitation_create);
	expect(ACP_CLIENT_METHODS.fsReadTextFile).toBe(CLIENT_METHODS.fs_read_text_file);
	expect(ACP_CLIENT_METHODS.fsWriteTextFile).toBe(CLIENT_METHODS.fs_write_text_file);
});
