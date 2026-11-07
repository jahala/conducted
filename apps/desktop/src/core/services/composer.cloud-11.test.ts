// @vitest-environment node
/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: a chat attachment in a cloud workspace. Sending it uploads the staged file into the
 * sandbox's `.context/attachments` through the Worker's file route, as Conductor does, instead of
 * writing to a Mac folder. D120 records that the route carries text only for now.
 * Test first: sending a text attachment to a cloud workspace writes it into the sandbox.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok, type SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";

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

describe("CLOUD-11 attachments in a cloud workspace", () => {
	it("uploads a staged attachment into the sandbox's .context folder", async () => {
		const test = createTestContainer();
		active = test;
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			path: "/workspace/oslo",
			host: { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" },
		});
		const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		test.memory.controls.files.set("/tmp/notes.txt", "hello");
		const composer = test.container.services.composer;
		const staged = must(await composer.addAttachments(session.id, ["/tmp/notes.txt"]));

		const written: { path: string; text: string }[] = [];
		test.memory.controls.scriptCloud((request) => {
			if (request.path !== "/w/vm-1/files") return null;
			const body = request.body as { operation?: string; path?: string; text?: string };
			if (body.operation !== "write") return null;
			written.push({ path: body.path ?? "", text: body.text ?? "" });
			return ok({ status: 200, body: "{}" });
		});

		const materialized = must(
			await composer.materializeForSend(
				session.id,
				workspace.path,
				"message-1" as never,
				staged,
				"cloud",
			),
		);

		expect(materialized).toHaveLength(1);
		expect(materialized[0]).toMatch(/^\/workspace\/oslo\/\.context\/attachments\/.+\/notes\.txt$/);
		expect(written).toEqual([{ path: materialized[0], text: "hello" }]);
		const rows = await test.database.select<{ path: string; is_draft: number }>(
			"SELECT path, is_draft FROM attachments WHERE session_id = $1",
			[session.id as SessionId],
		);
		expect(rows).toEqual([{ path: materialized[0], is_draft: 0 }]);
		expect(test.memory.controls.files.has(materialized[0] ?? "")).toBe(false);
	});
});
