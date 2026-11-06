/**
 * @feature CHAT-17 Chat history search in the command palette
 * Owns: the test that a stored message found by the palette opens its chat.
 * Behaviour: ui-map.md 5.1 (chat history search runs a LIKE over stored message text).
 * Test first: typing a word from a stored message lists the chat and opens it.
 */
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedSessionEvent,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";

const CONFIG = {
	agent: "claude" as const,
	model: "default",
	effort: "high" as const,
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	useOverlayStore.getState().close();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

describe("CHAT-17 chat history in the palette", () => {
	it("lists a stored message and opens its chat", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const repo = await seedRepo(test.container, { name: "conducted" });
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "fix-login",
		});
		const sessions = test.container.services.sessions;
		const chat = must(await sessions.create(workspace.id, CONFIG));
		must(await sessions.start());
		must(await sessions.rename(chat.id, "Login chat"));

		await seedSessionEvent(
			test.container,
			chat.id,
			{
				type: "user_message",
				eventId: "e1" as EventId,
				at: 100,
				turnId: "turn-1" as TurnId,
				messageId: "m1" as MessageId,
				text: "Fix the login bug",
				attachmentPaths: [],
				delivery: "new_turn",
				config: CONFIG,
			},
			100,
		);

		const router = createAppRouter(
			createMemoryHistory({
				initialEntries: [`/repository/${workspace.repoId}/workspace/${workspace.id}`],
			}),
		);
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();
		useOverlayStore.getState().show("palette");

		const input = await screen.findByPlaceholderText("Type a command or search...");
		fireEvent.change(input, { target: { value: "bug" } });
		fireEvent.click(await screen.findByText(/Login chat: Fix the login bug/));

		await waitFor(() =>
			expect(router.state.location.search).toEqual({ tab: "session", sessionId: chat.id }),
		);
	});
});
