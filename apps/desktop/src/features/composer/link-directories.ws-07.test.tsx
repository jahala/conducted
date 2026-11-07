/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests that the composer's '+' menu, its '@' menu and the /add-dir slash command open the
 * Link workspaces and directories dialog over the real container.
 * Behaviour: ui-map.md 3.5 ('+' menu "Link workspaces"; '@' linked directories and "Select working
 * directories"; slash /add-dir) and 3.10.
 * Test first: the '+' menu's "Link workspaces" opens the dialog.
 */
import type { SessionConfig } from "@conducted/protocol";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { unmountComposer } from "../../test/composer-teardown.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Composer } from "./Composer.tsx";

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

let active: TestContainer | undefined;
let mountedEditor: Editor | null = null;

afterEach(async () => {
	await unmountComposer(mountedEditor);
	mountedEditor = null;
	active?.close();
	active = undefined;
});

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

async function setup() {
	const test = createTestContainer();
	active = test;
	const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/shared"] });
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	let editor: Editor | null = null;
	render(
		<Composer
			workspaceId={workspace.id}
			sessionId={session.id}
			onEditorReady={(next) => {
				editor = next;
				mountedEditor = next;
			}}
		/>,
		{ wrapper },
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return { test, workspace, session, editor: () => editor as Editor | null };
}

describe("WS-07 opening the link dialog from the composer", () => {
	it("opens it from the '+' menu's Link workspaces item", async () => {
		await setup();
		const trigger = await screen.findByRole("button", {
			name: "Add attachments, link issues, and more",
		});
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });

		fireEvent.click(await screen.findByRole("menuitem", { name: /Link workspaces/ }));

		expect(
			await screen.findByRole("heading", { name: "Link workspaces and directories" }),
		).toBeTruthy();
	});

	it("lists linked folders after '@' and opens the dialog from Select working directories", async () => {
		const { editor } = await setup();
		act(() => editor()?.commands.insertContent("@"));

		expect(await screen.findByRole("option", { name: /\/code\/shared/ })).toBeTruthy();
		fireEvent.click(await screen.findByRole("option", { name: /Select working directories/ }));

		expect(
			await screen.findByRole("heading", { name: "Link workspaces and directories" }),
		).toBeTruthy();
	});

	it("opens it when the user runs /add-dir", async () => {
		const { editor } = await setup();
		act(() => editor()?.commands.insertContent("/add-dir"));
		fireEvent.click(await screen.findByRole("option", { name: /\/add-dir/ }));

		expect(
			await screen.findByRole("heading", { name: "Link workspaces and directories" }),
		).toBeTruthy();
	});
});
