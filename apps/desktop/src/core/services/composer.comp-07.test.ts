// @vitest-environment node
/**
 * @feature COMP-07 Attachments: drop, paste, pick
 * Owns: tests of the composer service's attachment staging, removal and copy into a workspace.
 * Behaviour: services-map.md 2.3.5 and 5A.6, ui-map.md 3.5.
 * Test first: dropping two files adds two paths to the draft in order.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { MAX_IMAGE_ATTACHMENT_BYTES } from "./composer.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

let active: TestContainer | undefined;

afterEach(() => {
	active?.close();
	active = undefined;
});

async function setup() {
	const test = createTestContainer();
	active = test;
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, CONFIG);
	const session = must(created);
	return { test, workspace, session, composer: test.container.services.composer };
}

const addFile = (test: TestContainer, path: string, text: string): void => {
	test.memory.controls.files.set(path, text);
};

const rowsFor = async (test: TestContainer, sessionId: SessionId) =>
	test.database.select<{ is_draft: number; kind: string; path: string; original_name: string }>(
		"SELECT is_draft, kind, path, original_name FROM attachments WHERE session_id = $1 ORDER BY created_at, id",
		[sessionId],
	);

describe("COMP-07 attachments service", () => {
	it("stages two files in order and inserts a draft row for each", async () => {
		const { test, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		addFile(test, "/tmp/two.md", "two");

		const staged = await composer.addAttachments(session.id, ["/tmp/one.txt", "/tmp/two.md"]);

		const paths = must(staged);
		expect(paths).toHaveLength(2);
		expect(paths[0]?.endsWith("/one.txt")).toBe(true);
		expect(paths[1]?.endsWith("/two.md")).toBe(true);
		expect(composer.draftOf(session.id).attachmentPaths).toEqual(paths);
		const rows = await rowsFor(test, session.id);
		expect(rows.map((row) => row.original_name)).toEqual(["one.txt", "two.md"]);
		expect(rows.every((row) => row.is_draft === 1)).toBe(true);
	});

	it("stores a PDF as its own kind", async () => {
		const { test, session, composer } = await setup();
		addFile(test, "/tmp/report.pdf", "pdf");

		must(await composer.addAttachments(session.id, ["/tmp/report.pdf"]));

		const rows = await rowsFor(test, session.id);
		expect(rows[0]?.kind).toBe("pdf");
	});

	it("refuses a folder with 'Folders can't be uploaded'", async () => {
		const { test, session, composer } = await setup();
		must(await test.memory.platform.fs.mkdirp("/tmp/a-folder"));

		const result = await composer.addAttachments(session.id, ["/tmp/a-folder"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("Folders can't be uploaded");
		expect(composer.draftOf(session.id).attachmentPaths).toEqual([]);
	});

	it("refuses an image over 5 MB with 'Image too large'", async () => {
		const { test, session, composer } = await setup();
		addFile(test, "/tmp/huge.png", "x".repeat(MAX_IMAGE_ATTACHMENT_BYTES + 1));

		const result = await composer.addAttachments(session.id, ["/tmp/huge.png"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("Image too large");
	});

	it("stages pasted image bytes as an image attachment on the draft", async () => {
		const { test, session, composer } = await setup();

		const added = must(
			await composer.addBytes(session.id, "image.png", new TextEncoder().encode("png bytes")),
		);

		expect(added.kind).toBe("image");
		expect(test.memory.controls.files.get(added.path)).toBe("png bytes");
		expect(composer.draftOf(session.id).attachmentPaths).toEqual([added.path]);
		expect(await rowsFor(test, session.id)).toEqual([
			expect.objectContaining({ is_draft: 1, kind: "image", original_name: "image.png" }),
		]);
	});

	it("refuses pasted image bytes over 5 MB with 'Image too large' and stages nothing", async () => {
		const { test, session, composer } = await setup();

		const result = await composer.addBytes(
			session.id,
			"huge.png",
			new Uint8Array(MAX_IMAGE_ATTACHMENT_BYTES + 1),
		);

		expect(result.ok ? null : result.error.message).toBe("Image too large");
		expect(await rowsFor(test, session.id)).toEqual([]);
	});

	it("refuses pasted bytes with no file name as unavailable", async () => {
		const { session, composer } = await setup();

		const result = await composer.addBytes(session.id, "", new TextEncoder().encode("x"));

		expect(result.ok ? null : result.error.message).toBe("Attachments not available");
	});

	it("removes a draft attachment, trashes its staged file and updates the draft", async () => {
		const { test, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		const staged = must(await composer.addAttachments(session.id, ["/tmp/one.txt"]));

		must(await composer.removeAttachment(session.id, staged[0] ?? ""));

		expect(composer.draftOf(session.id).attachmentPaths).toEqual([]);
		expect(test.memory.controls.files.has(staged[0] ?? "")).toBe(false);
		expect(await rowsFor(test, session.id)).toEqual([]);
	});

	it("copies a staged file into the workspace and flips its row to sent", async () => {
		const { test, workspace, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		const staged = must(await composer.addAttachments(session.id, ["/tmp/one.txt"]));

		const sent = must(await composer.materializeForSend(session.id, workspace.path, "message-1"));

		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain(`${workspace.path}/.context/attachments/`);
		expect(sent[0]?.endsWith("/one.txt")).toBe(true);
		expect(test.memory.controls.files.has(sent[0] ?? "")).toBe(true);
		const rows = await rowsFor(test, session.id);
		expect(rows[0]?.is_draft).toBe(0);
		expect(rows[0]?.path).toBe(sent[0]);
		expect(staged).toHaveLength(1);
	});

	it("removes the staging copy when the message is sent", async () => {
		const { test, workspace, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		const staged = must(await composer.addAttachments(session.id, ["/tmp/one.txt"]));

		must(await composer.materializeForSend(session.id, workspace.path, "message-1"));

		expect(test.memory.controls.files.has(staged[0] ?? "")).toBe(false);
	});

	it("refuses a send while a copy is still running", async () => {
		const { test, workspace, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		addFile(test, "/tmp/two.txt", "two");

		const adding = composer.addAttachments(session.id, ["/tmp/one.txt", "/tmp/two.txt"]);
		const during = await composer.materializeForSend(session.id, workspace.path, "message-1");
		await adding;

		expect(during.ok).toBe(false);
		if (during.ok) return;
		expect(during.error.message).toBe("Wait for attachments to finish processing.");
	});

	it("shows 'Attachments not available' for a staged file that disappeared", async () => {
		const { test, workspace, session, composer } = await setup();
		addFile(test, "/tmp/one.txt", "one");
		const staged = must(await composer.addAttachments(session.id, ["/tmp/one.txt"]));
		test.memory.controls.files.delete(staged[0] ?? "");

		const result = await composer.materializeForSend(session.id, workspace.path, "message-1");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("Attachments not available");
	});
});
