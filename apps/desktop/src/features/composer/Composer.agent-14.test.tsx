/**
 * @feature AGENT-14 Codex `/compact`
 * Owns: the join test that choosing /compact in a Codex chat, through the real composer and the
 * container's real sessions service, asks the app to compact the chat.
 * Behaviour: D054 (a feature is reachable from the composition root) and ui-map.md 3.5.
 * Test first: picking /compact for a Codex chat calls SessionsService.compact.
 */
import type { SessionConfig, SlashCommand } from "@conducted/protocol";
import { ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const CONFIG: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
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
				createElement(Toaster),
			),
		),
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return editor as unknown as Editor;
}

/**
 * Answers the agent's slash command list with `commands`.
 * seam: AGENT-14 the list comes from the sidecar, which this container does not run.
 */
function listSlashCommands(test: TestContainer, sessionId: SessionId, commands: SlashCommand[]) {
	const catalog = test.container.services.agentCatalog;
	vi.spyOn(catalog, "loadSlashCommands").mockImplementation(async () => {
		catalog.store.setState((state) => ({
			slashCommands: { ...state.slashCommands, [sessionId]: { state: "ready", data: commands } },
		}));
		return ok(commands);
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("AGENT-14 /compact from the composer", () => {
	it("compacts a Codex chat when /compact is chosen", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			// seam: AGENT-14 compact reaches the sidecar, which this container does not run.
			const compact = vi
				.spyOn(test.container.services.sessions, "compact")
				.mockResolvedValue(ok(undefined));
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/co");
			});

			fireEvent.click(await screen.findByText("/compact"));

			await waitFor(() => expect(compact).toHaveBeenCalledWith(created.id));
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
