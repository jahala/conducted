/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: the join test that choosing /goal in a Codex chat, through the real composer and the
 * container's sessions service, opens the goal bar's field.
 * Behaviour: D054 (a feature is reachable from the composition root) and ui-map.md 3.5.
 * Test first: choosing /goal focuses the Goal field.
 */
import type { SessionConfig } from "@conducted/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
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
	workspaceId: string,
	sessionId: string,
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

/** Answers the goal reads and writes the sidecar cannot answer in this container. */
function answerGoalCalls(test: TestContainer): void {
	const transport = test.memory.platform.sidecar;
	const original = transport.send.bind(transport);
	transport.send = async (line) => {
		const answered = await original(line);
		const parsed = JSON.parse(line) as { id?: number; method?: string };
		if (
			parsed.method === "getGoal" ||
			parsed.method === "setGoal" ||
			parsed.method === "changeGoal"
		) {
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { goal: null } }),
				),
			);
		}
		return answered;
	};
}

afterEach(cleanup);

describe("COMP-10 /goal from the composer", () => {
	it("focuses the goal bar's Goal field when /goal is chosen", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const started = await test.container.sidecar.start();
			if (!started.ok) throw new Error(JSON.stringify(started.error));
			answerGoalCalls(test);
			const editor = await mountComposer(test, workspace.id, session.id);
			act(() => {
				editor.commands.insertContent("/go");
			});

			fireEvent.click(await screen.findByText("/goal"));

			await waitFor(() =>
				expect(document.activeElement).toBe(screen.getByPlaceholderText("Goal")),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
