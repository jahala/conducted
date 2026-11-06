/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: the test that choosing /goal in a Codex chat, through the real composer and the
 * container's sessions service, puts the composer in goal mode: the editor says "Set a goal" and
 * sending sets the goal ('/goal <text>') instead of sending a message.
 * Behaviour: D054 (a feature is reachable from the composition root), ui-map.md 3.5, and
 * Conductor's composer (its goal mode, from the frontend bundle).
 * Test first: choosing /goal shows "Set a goal", and Enter sends '/goal <text>'.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { answerSidecar, deliveredAsAsked } from "../../test/sidecar-answers.ts";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;
const Services = ServicesProvider as unknown as LooseComponent;

async function mountComposer(
	test: TestContainer,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
): Promise<Editor> {
	let editor: Editor | null = null;
	render(
		createElement(
			Services,
			{ container: test.container },
			createElement(
				Fragment,
				null,
				createElement(Composer, {
					workspaceId,
					sessionId,
					onEditorReady: (ready: Editor | null) => {
						editor = ready;
					},
				}),
			),
		),
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return editor as unknown as Editor;
}

afterEach(cleanup);

describe("COMP-10 /goal from the composer", () => {
	it("puts the composer in goal mode and sends the text as the goal", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const started = await test.container.sidecar.start();
			if (!started.ok) throw new Error(JSON.stringify(started.error));
			const calls = answerSidecar(test, deliveredAsAsked);
			const editor = await mountComposer(test, workspace.id, session.id);
			act(() => {
				editor.commands.insertContent("/go");
			});

			fireEvent.click(await screen.findByText("/goal"));

			expect(await screen.findByText("Set a goal")).toBeTruthy();
			act(() => {
				editor.commands.insertContent("Ship the importer");
			});
			fireEvent.keyDown(screen.getByRole("textbox", { name: "composer" }), { key: "Enter" });
			await waitFor(() =>
				expect(
					calls.filter((call) => call.method === "sendMessage").map((call) => call.params.text),
				).toEqual(["/goal Ship the importer"]),
			);
			await waitFor(() => expect(screen.queryByText("Set a goal")).toBeNull());
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
