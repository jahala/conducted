/**
 * @feature REV-03 Review comment tab
 * Tests the comment tab over the real container: loading a comment, a missing one, navigation,
 * and deletion reaching the service.
 */
import type { CommentId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, useCommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { CommentTab } from "./CommentTab.tsx";

function Dispatcher({ children }: { children: React.ReactNode }) {
	useCommandDispatcher();
	return <div data-command-scope="diff">{children}</div>;
}

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	clearCommandHandlers();
	test?.close();
	test = undefined;
});

async function addComment(file: string, line: number, body: string): Promise<CommentId> {
	if (test === undefined) throw new Error("test container missing");
	const workspace = await seedWorkspace(test.container);
	const added = await test.container.services.review.add(workspace.id, file, line, null, body);
	if (!added.ok) throw new Error(added.error.message);
	return added.value.id;
}

describe("REV-03 CommentTab", () => {
	it("renders 'Comment not found' for a comment that no longer exists", async () => {
		test = createTestContainer();
		const existing = await addComment("src/a.ts", 3, "A real comment");
		const workspace = Object.values(
			test.container.services.workspace.store.getState().workspacesById,
		)[0];
		if (workspace === undefined) throw new Error("workspace missing");

		render(
			<ServicesProvider container={test.container}>
				<CommentTab workspaceId={workspace.id} commentId={"gone" as CommentId} />
			</ServicesProvider>,
		);

		expect(await screen.findByText("Comment not found")).toBeTruthy();
		expect(existing).not.toBeNull();
	});

	it("shows the comment with its file and line and deletes it through the service", async () => {
		test = createTestContainer();
		const id = await addComment("src/a.ts", 12, "Please rename this");
		const workspace = Object.values(
			test.container.services.workspace.store.getState().workspacesById,
		)[0];
		if (workspace === undefined) throw new Error("workspace missing");

		render(
			<ServicesProvider container={test.container}>
				<CommentTab workspaceId={workspace.id} commentId={id} />
			</ServicesProvider>,
		);

		expect(await screen.findByText("Please rename this")).toBeTruthy();
		expect(screen.getByText("src/a.ts")).toBeTruthy();
		expect(screen.getByText("line 12")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));

		expect(await screen.findByText("Comment not found")).toBeTruthy();
	});

	it("opens the next comment when Cmd+Alt+J reaches the dispatcher", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const first = await test.container.services.review.add(
			workspace.id,
			"src/a.ts",
			1,
			null,
			"first",
		);
		const second = await test.container.services.review.add(
			workspace.id,
			"src/b.ts",
			1,
			null,
			"second",
		);
		if (!first.ok || !second.ok) throw new Error("comment did not save");
		const onOpenComment = vi.fn();

		render(
			<ServicesProvider container={test.container}>
				<Dispatcher>
					<CommentTab
						workspaceId={workspace.id}
						commentId={first.value.id}
						onOpenComment={onOpenComment}
					/>
				</Dispatcher>
			</ServicesProvider>,
		);

		const body = await screen.findByText("first");
		fireEvent.keyDown(body, { key: "j", metaKey: true, altKey: true });
		expect(onOpenComment).toHaveBeenCalledWith(second.value.id);
	});

	it("opens the next comment when the screen offers navigation", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const first = await test.container.services.review.add(
			workspace.id,
			"src/a.ts",
			1,
			null,
			"first",
		);
		const second = await test.container.services.review.add(
			workspace.id,
			"src/b.ts",
			1,
			null,
			"second",
		);
		if (!first.ok || !second.ok) throw new Error("comment did not save");
		const onOpenComment = vi.fn();

		render(
			<ServicesProvider container={test.container}>
				<CommentTab
					workspaceId={workspace.id}
					commentId={first.value.id}
					onOpenComment={onOpenComment}
				/>
			</ServicesProvider>,
		);

		expect(await screen.findByText("first")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Next comment" }));
		expect(onOpenComment).toHaveBeenCalledWith(second.value.id);
	});
});
