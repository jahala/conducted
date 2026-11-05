/**
 * @feature NAV-11 Next unread button
 * Owns: the tests for the chat button and the app-level handlers that jump to the next chat
 * needing attention.
 * Behaviour: ui-map.md 3.3, 5.1, 5.4.
 * Test first: with one other chat unread the button shows and click navigates to that chat.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";

const navigate = vi.hoisted(() => vi.fn());
const currentSession = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	useRouterState: ({
		select,
	}: {
		select: (state: { location: { search: Record<string, unknown> } }) => unknown;
	}) =>
		select({
			location: {
				search: currentSession.id === null ? {} : { sessionId: currentSession.id },
			},
		}),
}));

const { CommandRegistryProvider, createCommandRegistry, dispatchCommand } = await import(
	"../../app/command-dispatcher.ts"
);
const { NextUnreadButton, NextUnreadController } = await import("./NextUnreadButton.tsx");

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

async function addChat(
	container: Container,
	workspace: Workspace,
	unread: number,
): Promise<SessionId> {
	const created = await container.actions.sessions.create(workspace.id, CONFIG);
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	if (unread > 0) {
		await container.platform.db.execute("UPDATE sessions SET unread_count = $1 WHERE id = $2", [
			unread,
			created.value.id,
		]);
	}
	return created.value.id;
}

function setup() {
	const test = createTestContainer();
	return {
		...test,
		render(children: ReactNode) {
			return render(<ServicesProvider container={test.container}>{children}</ServicesProvider>);
		},
	};
}

function setAttentionBinding(container: Container, key: string): void {
	container.services.settings.store.setState((state) => ({
		values: {
			...state.values,
			keybinding_overrides_v1: JSON.stringify({ "chat.nextNeedingAttention": [key] }),
		},
	}));
}

afterEach(() => {
	cleanup();
	navigate.mockReset();
	currentSession.id = null;
});

describe("NAV-11 NextUnreadButton", () => {
	it("stays hidden when nothing else needs the user", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			const current = await addChat(test.container, workspace, 0);
			await test.container.services.sessions.start();
			test.render(<NextUnreadButton currentSessionId={current} />);
			expect(screen.queryByRole("button", { name: "Next unread" })).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows for an unread chat in another workspace and opens it", async () => {
		const test = setup();
		try {
			const first = await seedWorkspace(test.container);
			const second = await seedWorkspace(test.container, { repoId: first.repoId });
			const current = await addChat(test.container, first, 0);
			const target = await addChat(test.container, second, 2);
			await test.container.services.sessions.start();
			test.render(<NextUnreadButton currentSessionId={current} />);

			fireEvent.click(await screen.findByRole("button", { name: "Next unread" }));
			expect(navigate).toHaveBeenCalledWith({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: { repositoryId: second.repoId, workspaceId: second.id },
				search: { tab: "session", sessionId: target },
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("skips the current chat when it is the only unread one", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			const current = await addChat(test.container, workspace, 1);
			await test.container.services.sessions.start();
			test.render(<NextUnreadButton currentSessionId={current} />);
			expect(screen.queryByRole("button", { name: "Next unread" })).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows the rebound key in the hint", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			const current = await addChat(test.container, workspace, 0);
			await addChat(test.container, workspace, 1);
			await test.container.services.sessions.start();
			setAttentionBinding(test.container, "Cmd+Alt+J");
			test.render(<NextUnreadButton currentSessionId={current} />);
			expect(await screen.findByText("⌥⌘J")).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("NAV-11 NextUnreadController", () => {
	for (const commandId of ["nav.nextUnread", "chat.nextNeedingAttention"] as const) {
		it(`navigates on ${commandId} with no chat open`, async () => {
			const test = setup();
			try {
				const first = await seedWorkspace(test.container);
				const second = await seedWorkspace(test.container, { repoId: first.repoId });
				const target = await addChat(test.container, second, 2);
				await test.container.services.sessions.start();
				const registry = createCommandRegistry();
				test.render(
					<CommandRegistryProvider registry={registry}>
						<NextUnreadController />
					</CommandRegistryProvider>,
				);
				const dispatch = () =>
					dispatchCommand(commandId, {
						registry,
						isEnabled: (id) => test.container.services.commands.isEnabled(id),
						run: (id) => test.container.services.commands.run(id),
						report: () => {},
						failed: () => {},
					});

				await waitFor(() => {
					dispatch();
					expect(navigate).toHaveBeenCalledWith({
						to: "/repository/$repositoryId/workspace/$workspaceId",
						params: { repositoryId: second.repoId, workspaceId: second.id },
						search: { tab: "session", sessionId: target },
					});
				});
			} finally {
				await test.container.stop();
				test.close();
			}
		});
	}

	it("keeps both commands enabled with no chat on screen", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			await addChat(test.container, workspace, 0);
			await test.container.services.sessions.start();
			expect(test.container.services.commands.isEnabled("nav.nextUnread")).toBe(true);
			expect(test.container.services.commands.isEnabled("chat.nextNeedingAttention")).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("does nothing when no chat needs the user", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			await addChat(test.container, workspace, 0);
			await test.container.services.sessions.start();
			const registry = createCommandRegistry();
			test.render(
				<CommandRegistryProvider registry={registry}>
					<NextUnreadController />
				</CommandRegistryProvider>,
			);

			await act(async () => {
				expect(registry.run("nav.nextUnread")).toBe(false);
			});
			expect(navigate).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
