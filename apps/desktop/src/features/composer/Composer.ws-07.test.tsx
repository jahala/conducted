/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the test that the composer keeps its editor while the workspace row changes, so the
 * linked folders it offers in the '@' menu never rebuild the editor under the user.
 * Behaviour: ui-map.md 3.5 ('@' mentions list linked directories).
 * Test first: renaming the workspace (a new row with new arrays) keeps the same editor and the
 * text typed in it.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;
const Services = ServicesProvider as unknown as LooseComponent;

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("WS-07 composer and the workspace row", () => {
	it("keeps the same editor and the typed text when the workspace row is replaced", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const created = await test.container.services.sessions.create(workspace.id, CONFIG);
		if (!created.ok) throw new Error(created.error.message);
		const editors: Editor[] = [];
		render(
			createElement(
				Services,
				{ container: test.container },
				createElement(Composer, {
					workspaceId: workspace.id as WorkspaceId,
					sessionId: created.value.id,
					onEditorReady: (ready: Editor | null) => {
						if (ready !== null && !editors.includes(ready)) editors.push(ready);
					},
				}),
			),
		);
		await waitFor(() => expect(editors).toHaveLength(1));
		const editor = editors[0] as Editor;
		act(() => {
			editor.commands.insertContent("half a thought");
		});

		// A rename reads the row back from the database: a new object with new arrays.
		const store = test.container.services.workspace.store;
		act(() => {
			store.setState((state) => {
				const row = state.workspacesById[workspace.id];
				if (row === undefined) throw new Error("the seeded workspace is not in the store");
				return {
					workspacesById: {
						...state.workspacesById,
						[workspace.id]: { ...row, name: "renamed", linkedPaths: [...row.linkedPaths] },
					},
				};
			});
		});

		expect(editors).toEqual([editor]);
		expect(editor.isDestroyed).toBe(false);
		expect(editor.getText()).toBe("half a thought");
	});
});
