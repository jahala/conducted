/**
 * @feature NAV-11 Next unread button
 * Owns: the tests for the chat button that jumps to the next chat needing attention.
 * Behaviour: ui-map.md 3.3, 5.4.
 * Test first: with one other chat unread the button shows and click navigates to that chat.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

const { NextUnreadButton } = await import("./NextUnreadButton.tsx");

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
		render(sessionId: SessionId) {
			return render(
				<ServicesProvider container={test.container}>
					<NextUnreadButton currentSessionId={sessionId} />
				</ServicesProvider>,
			);
		},
	};
}

afterEach(() => {
	cleanup();
	navigate.mockReset();
});

describe("NAV-11 NextUnreadButton", () => {
	it("stays hidden when nothing else needs the user", async () => {
		const test = setup();
		try {
			const workspace = await seedWorkspace(test.container);
			const current = await addChat(test.container, workspace, 0);
			await test.container.services.sessions.start();
			test.render(current);
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
			test.render(current);

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
			test.render(current);
			expect(screen.queryByRole("button", { name: "Next unread" })).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
