/**
 * @feature APP-09 Send feedback
 * Owns: the tests that the feedback form becomes a new issue on the project's GitHub page, through
 * the real composition root.
 * Behaviour: ui-map.md 5.2 (message, email, images, recent app logs).
 * Test first: a message, email, image and logs become a GitHub issue URL that holds all four.
 */
import { appError, err } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { MAX_FEEDBACK_URL_CHARS } from "./system.ts";

/** The project's new-issue page, where feedback goes (APP-09's row). */
const ISSUE_PAGE = "https://github.com/jahala/conducted/issues/new";

const opened: TestContainer[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const test of opened.splice(0)) test.close();
});

async function setup(logs: string | null) {
	const test = createTestContainer();
	opened.push(test);
	if (logs !== null) {
		const exported = await test.container.platform.app.exportLogs();
		if (!exported.ok) throw new Error(exported.error.message);
		test.memory.controls.files.set(exported.value, logs);
	}
	// seam: APP-09 the browser is outside the app; the test reads the URL it would open.
	const openUrl = vi.spyOn(test.container.platform.opener, "openUrl").mockResolvedValue();
	return { test, openUrl };
}

function openedIssue(openUrl: { mock: { calls: unknown[][] } }): { title: string; body: string } {
	const url = new URL(String(openUrl.mock.calls[0]?.[0]));
	expect(`${url.origin}${url.pathname}`).toBe(ISSUE_PAGE);
	return { title: url.searchParams.get("title") ?? "", body: url.searchParams.get("body") ?? "" };
}

describe("APP-09 send feedback", () => {
	it("APP-09 a message, email, image and logs become a GitHub issue URL that holds all four", async () => {
		const { test, openUrl } = await setup('{"msg":"sidecar started"}');

		const sent = await test.container.actions.app.sendFeedback({
			message: "The diff view jumps\nwhen I scroll fast.",
			email: "person@example.com",
			imagePaths: ["/Users/me/Desktop/jump.png"],
			includeLogs: true,
		});

		expect(sent.ok).toBe(true);
		expect(openUrl).toHaveBeenCalledTimes(1);
		const issue = openedIssue(openUrl);
		expect(issue.title).toBe("The diff view jumps");
		expect(issue.body).toContain("The diff view jumps\nwhen I scroll fast.");
		expect(issue.body).toContain("person@example.com");
		expect(issue.body).toContain("/Users/me/Desktop/jump.png");
		expect(issue.body).toContain('{"msg":"sidecar started"}');
	});

	it("APP-09 leaves the logs out unless asked", async () => {
		const { test, openUrl } = await setup('{"msg":"secret path"}');

		const sent = await test.container.actions.app.sendFeedback({
			message: "Works well",
			email: null,
			imagePaths: [],
			includeLogs: false,
		});

		expect(sent.ok).toBe(true);
		expect(openedIssue(openUrl).body).not.toContain("secret path");
	});

	it("APP-09 refuses an empty message and opens nothing", async () => {
		const { test, openUrl } = await setup(null);

		const sent = await test.container.actions.app.sendFeedback({
			message: "   ",
			email: null,
			imagePaths: [],
			includeLogs: false,
		});

		expect(sent.ok).toBe(false);
		if (!sent.ok) expect(sent.error.code).toBe("feedback_message_empty");
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("APP-09 reports a log export that fails instead of opening an issue without the logs", async () => {
		const { test, openUrl } = await setup(null);
		vi.spyOn(test.container.platform.app, "exportLogs").mockResolvedValue(
			err(appError("logs_export_failed", "The logs folder could not be read.")),
		);

		const sent = await test.container.actions.app.sendFeedback({
			message: "Crash on start",
			email: null,
			imagePaths: [],
			includeLogs: true,
		});

		expect(sent.ok).toBe(false);
		if (!sent.ok) expect(sent.error.code).toBe("feedback_logs_failed");
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("APP-09 cuts long logs from the front so the issue link stays openable", async () => {
		const lines = Array.from({ length: 4000 }, (_, index) => `{"line":${index}}`);
		const { test, openUrl } = await setup(lines.join("\n"));

		const sent = await test.container.actions.app.sendFeedback({
			message: "Slow after an hour",
			email: null,
			imagePaths: [],
			includeLogs: true,
		});

		expect(sent.ok).toBe(true);
		const url = String(openUrl.mock.calls[0]?.[0]);
		expect(url.length).toBeLessThanOrEqual(MAX_FEEDBACK_URL_CHARS);
		const body = openedIssue(openUrl).body;
		expect(body).toContain("Slow after an hour");
		expect(body).toContain('{"line":3999}');
		expect(body).not.toContain('{"line":0}\n');
	});
});
