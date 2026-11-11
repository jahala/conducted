/**
 * @feature COMP-07 Attachments: drop, paste, pick
 * Owns: tests over the real container that the composer's '+' menu, drop, paste and attachment bar
 * change the chat's draft.
 * Behaviour: ui-map.md 3.5 and 5.4, services-map.md 5A.6.1.
 * Test first: dropping two files adds two paths to the draft in order.
 */
import type { SessionConfig } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { AttachmentBar } from "./AttachmentBar.tsx";
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

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

async function setup() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	test.container.services.sessions.store.setState((state) => ({
		...state,
		viewingSessionId: session.id,
	}));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	const close = () => test.close();
	return { test, workspace, session, wrapper, close };
}

const addFile = (test: TestContainer, path: string, text: string): void => {
	test.memory.controls.files.set(path, text);
};

const editor = () => screen.getByLabelText("composer");

const attachmentList = () => screen.queryByRole("list", { name: "Attachments" });

const attachmentNames = (): string[] => {
	const list = attachmentList();
	if (list === null) return [];
	return within(list)
		.queryAllByRole("listitem")
		.map((item) => item.textContent ?? "");
};

async function openPlusMenu(): Promise<void> {
	const trigger = await screen.findByRole("button", {
		name: "Add attachments, link issues, and more",
	});
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("COMP-07 attachments in the composer", () => {
	it("shows a copying row while an attachment is being added", async () => {
		const { session, close } = await setup();
		try {
			render(
				<AttachmentBar
					sessionId={session.id}
					attachmentPaths={["/tmp/one.txt"]}
					busy
					onRemove={() => {}}
				/>,
			);
			expect(screen.getByRole("status").textContent).toContain("Copying attachment");
			expect(screen.getByRole("status", { name: "Loading attachment" })).toBeTruthy();
		} finally {
			close();
		}
	});

	it("lists the plus menu items", async () => {
		const { session, workspace, wrapper, close } = await setup();
		try {
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await openPlusMenu();

			for (const name of [
				/Add attachment/,
				/Link issue/,
				/Link workspaces/,
				/Plan mode/,
				/Add snippet/,
			]) {
				expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
			}
		} finally {
			close();
		}
	});

	it("adds the files chosen in the picker, in order", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			addFile(test, "/tmp/two.md", "two");
			test.memory.controls.queueDialogAnswers({ files: ["/tmp/one.txt", "/tmp/two.md"] });
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			await openPlusMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /Add attachment/ }));

			await waitFor(() => expect(attachmentNames()).toHaveLength(2));
			const names = attachmentNames();
			expect(names[0]).toContain("one.txt");
			expect(names[1]).toContain("two.md");
			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toHaveLength(
					2,
				),
			);
		} finally {
			close();
		}
	});

	it("adds two dropped files to the draft in order", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			addFile(test, "/tmp/two.md", "two");
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			test.memory.controls.emitFileDrop({
				kind: "drop",
				paths: ["/tmp/one.txt", "/tmp/two.md"],
				x: 10,
				y: 10,
			});

			await waitFor(() => expect(attachmentNames()).toHaveLength(2));
			const names = attachmentNames();
			expect(names[0]).toContain("one.txt");
			expect(names[1]).toContain("two.md");
			const draft = test.container.services.composer.draftOf(session.id);
			expect(draft.attachmentPaths[0]?.endsWith("/one.txt")).toBe(true);
			expect(draft.attachmentPaths[1]?.endsWith("/two.md")).toBe(true);
		} finally {
			close();
		}
	});

	it("leaves a dropped file to the chat on screen when another chat's composer is mounted too", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			const other = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			render(
				<>
					<Composer workspaceId={workspace.id} sessionId={session.id} />
					<Composer workspaceId={workspace.id} sessionId={other.id} />
				</>,
				{ wrapper },
			);
			expect(test.container.services.sessions.store.getState().viewingSessionId).toBe(session.id);

			test.memory.controls.emitFileDrop({ kind: "drop", paths: ["/tmp/one.txt"], x: 10, y: 10 });

			const drafts = test.container.services.composer;
			await waitFor(() => expect(drafts.draftOf(session.id).attachmentPaths).toHaveLength(1));
			expect(screen.queryAllByRole("list", { name: "Attachments" })).toHaveLength(1);
			expect(drafts.draftOf(other.id).attachmentPaths).toHaveLength(0);
		} finally {
			close();
		}
	});

	it("removes one attachment and updates the draft", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			addFile(test, "/tmp/two.md", "two");
			test.memory.controls.queueDialogAnswers({ files: ["/tmp/one.txt", "/tmp/two.md"] });
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			await openPlusMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /Add attachment/ }));
			await waitFor(() => expect(attachmentNames()).toHaveLength(2));

			fireEvent.click(screen.getByRole("button", { name: "Remove one.txt" }));

			await waitFor(() => expect(attachmentNames()).toHaveLength(1));
			expect(attachmentNames()[0]).toContain("two.md");
			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toHaveLength(
					1,
				),
			);
		} finally {
			close();
		}
	});

	it("refuses a dropped folder with 'Folders can't be uploaded'", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		const toasted = vi.spyOn(toast, "error").mockReturnValue("toast-id");
		try {
			must(await test.memory.platform.fs.mkdirp("/tmp/a-folder"));
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			test.memory.controls.emitFileDrop({
				kind: "drop",
				paths: ["/tmp/a-folder"],
				x: 10,
				y: 10,
			});

			await waitFor(() => expect(toasted).toHaveBeenCalledWith("Folders can't be uploaded"));
			expect(attachmentNames()).toEqual([]);
		} finally {
			close();
		}
	});

	it("leaves the folder and size rules to the attachment service, which reads a dropped file once", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			const stat = vi.spyOn(test.memory.platform.fs, "stat");
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			test.memory.controls.emitFileDrop({ kind: "drop", paths: ["/tmp/one.txt"], x: 10, y: 10 });

			await waitFor(() => expect(attachmentNames()).toHaveLength(1));
			const ofDropped = stat.mock.calls.filter(([path]) => path === "/tmp/one.txt");
			expect(ofDropped).toHaveLength(1);
		} finally {
			close();
		}
	});

	it("attaches a file named like an app context file under another name", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/PR instructions.md", "mine");
			addFile(test, "/tmp/[GITHUB]-12.md", "mine too");
			addFile(test, "/tmp/notes.md", "plain");
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });

			test.memory.controls.emitFileDrop({
				kind: "drop",
				paths: ["/tmp/PR instructions.md", "/tmp/[GITHUB]-12.md", "/tmp/notes.md"],
				x: 10,
				y: 10,
			});

			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toHaveLength(
					3,
				),
			);
			const names = test.container.services.composer
				.draftOf(session.id)
				.attachmentPaths.map((path) => path.slice(path.lastIndexOf("/") + 1));
			expect(names).toEqual(["attached-PR instructions.md", "attached-[GITHUB]-12.md", "notes.md"]);
		} finally {
			close();
		}
	});

	it("opens the picker on Cmd+U", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			addFile(test, "/tmp/one.txt", "one");
			test.memory.controls.queueDialogAnswers({ files: ["/tmp/one.txt"] });
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await waitFor(() => expect(screen.getByLabelText("composer")).toBeTruthy());

			fireEvent.keyDown(document, { key: "u", metaKey: true });

			await waitFor(() => expect(attachmentNames()).toHaveLength(1));
			expect(attachmentNames()[0]).toContain("one.txt");
		} finally {
			close();
		}
	});

	it("pastes the files copied in Finder as paths on Cmd+Shift+V", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			test.memory.controls.setClipboardFilePaths(["/tmp/copied-one.txt", "/tmp/copied-two.txt"]);
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await waitFor(() => expect(editor()).toBeTruthy());
			editor().focus();

			fireEvent.keyDown(editor(), { key: "v", metaKey: true, shiftKey: true });

			await waitFor(() =>
				expect(editor().textContent).toContain("/tmp/copied-one.txt /tmp/copied-two.txt"),
			);
			expect(attachmentNames()).toEqual([]);
		} finally {
			close();
		}
	});

	it("turns long pasted text into a text attachment", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await waitFor(() => expect(editor()).toBeTruthy());

			fireEvent.paste(editor(), {
				clipboardData: {
					files: [],
					getData: (type: string) => (type === "text/plain" ? "x".repeat(5_001) : ""),
				},
			});

			await waitFor(() => expect(attachmentNames()).toHaveLength(1));
			expect(attachmentNames()[0]).toContain("pasted-text.txt");
			const draft = test.container.services.composer.draftOf(session.id);
			expect(draft.attachmentPaths).toHaveLength(1);
		} finally {
			close();
		}
	});

	it("leaves long pasted text in the editor when the setting is off", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		try {
			test.container.services.settings.store.setState((state) => ({
				...state,
				values: { ...state.values, auto_convert_long_text: false },
			}));
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await waitFor(() => expect(editor()).toBeTruthy());

			fireEvent.paste(editor(), {
				clipboardData: {
					files: [],
					getData: (type: string) => (type === "text/plain" ? "x".repeat(5_001) : ""),
				},
			});

			expect(attachmentNames()).toEqual([]);
			expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([]);
		} finally {
			close();
		}
	});

	it("adds a pasted image that has no path to the draft", async () => {
		const { test, session, workspace, wrapper, close } = await setup();
		const toasted = vi.spyOn(toast, "error").mockReturnValue("toast-id");
		try {
			render(<Composer workspaceId={workspace.id} sessionId={session.id} />, { wrapper });
			await waitFor(() => expect(editor()).toBeTruthy());

			fireEvent.paste(editor(), {
				clipboardData: {
					files: [new File(["image"], "shot.png", { type: "image/png" })],
					getData: () => "",
				},
			});

			await waitFor(() => expect(attachmentNames()).toHaveLength(1));
			expect(attachmentNames()[0]).toContain("shot.png");
			const [path] = test.container.services.composer.draftOf(session.id).attachmentPaths;
			expect(path === undefined ? undefined : test.memory.controls.files.get(path)).toBe("image");
			expect(toasted).not.toHaveBeenCalled();
		} finally {
			close();
		}
	});
});
