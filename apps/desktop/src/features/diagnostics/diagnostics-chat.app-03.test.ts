// @vitest-environment node
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

interface SentLine {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params: {
		text?: string;
		attachmentPaths?: string[];
	};
}

const ENVIRONMENT = ["LANG=en_AU.UTF-8", "API_TOKEN=super-secret", "HOME=/Users/conducted"].join(
	"\n",
);

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

function captureSends(container: TestContainer): SentLine[] {
	const transport = container.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	const sent: SentLine[] = [];
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as SentLine;
		if (parsed.method === "sendMessage") {
			sent.push(parsed);
			queueMicrotask(() =>
				container.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } }),
				),
			);
		}
		return answered;
	};
	return sent;
}

describe("APP-03 diagnostics chat", () => {
	it("writes a redacted report and starts a chat with it attached", async () => {
		test = createTestContainer();
		test.memory.controls.scriptShell((command) =>
			command.program === "/bin/zsh" ? ok({ exitCode: 0, stdout: ENVIRONMENT, stderr: "" }) : null,
		);
		await test.container.services.settings.start();
		await test.container.sidecar.start();
		const workspace = await seedWorkspace(test.container);
		const sent = captureSends(test);

		const result = await test.container.services.sessions.createDiagnosticsChat(workspace.id);

		expect(result.ok).toBe(true);
		expect(sent).toHaveLength(1);
		const message = sent[0]?.params;
		expect(message?.text).toBe("Here is my Conducted diagnostics report.");
		const attachment = message?.attachmentPaths?.[0];
		expect(attachment).toBeDefined();
		if (attachment === undefined) return;

		const written = await test.container.platform.fs.readText(attachment);
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		expect(written.value).toContain("API_TOKEN=");
		expect(written.value).not.toContain("super-secret");
		expect(written.value).toContain("LANG=en_AU.UTF-8");
	});

	it("returns an error when the report cannot be captured", async () => {
		test = createTestContainer();
		test.memory.controls.scriptShell((command) =>
			command.program === "/bin/zsh" ? err(appError("shell_failed", "No shell.")) : null,
		);
		await test.container.services.settings.start();
		const workspace = await seedWorkspace(test.container);

		const result = await test.container.services.sessions.createDiagnosticsChat(workspace.id);

		expect(result.ok).toBe(false);
	});
});
