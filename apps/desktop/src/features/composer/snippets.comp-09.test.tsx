/**
 * @feature COMP-09 Prompt snippets
 * Owns: tests over the real container for the snippet picker, the create and edit dialogs, the '+'
 * menu, Cmd+;, and the palette's Create snippet and Edit snippets actions.
 * Behaviour: ui-map.md 3.5, 5.1, 5.2, 5.4; inventory toast rows 688 and 689.
 * Test first: a saved snippet is listed in the picker, and choosing it hands its prompt to the
 * composer.
 */
import type { SessionConfig } from "@conducted/protocol";
import { appError, err } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";
import { SnippetOverlays } from "./SnippetOverlays.tsx";
import { useSnippetDialogsStore } from "./snippet-dialogs-store.ts";

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

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	toast.dismiss();
	useSnippetDialogsStore.getState().close();
	useOverlayStore.getState().close();
	vi.restoreAllMocks();
	for (const test of containers.splice(0)) test.close();
});

function newContainer(): TestContainer {
	const test = createTestContainer();
	containers.push(test);
	return test;
}

function renderOverlays(test: TestContainer) {
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<SnippetOverlays />
			</CommandDispatcher>
		</ServicesProvider>,
	);
}

async function seedSnippet(
	test: TestContainer,
	name = "Review",
	keyword: string | null = "rev",
	prompt = "Review this change.",
) {
	return must(await test.container.actions.snippets.create({ name, keyword, prompt }));
}

async function openPlusMenu(): Promise<void> {
	const trigger = await screen.findByRole("button", {
		name: "Add attachments, link issues, and more",
	});
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("COMP-09 snippet picker", () => {
	it("shows its loading state while the list is being read", async () => {
		const test = newContainer();
		vi.spyOn(test.container.services.composer, "loadSnippets").mockReturnValue(
			new Promise(() => undefined),
		);
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openPicker(vi.fn()));
		expect(await screen.findByRole("status", { name: "Loading snippets" })).toBeTruthy();
		expect(screen.getByPlaceholderText("Search snippets...")).toBeTruthy();
	});

	it("searches the saved snippets and hands a chosen prompt to the composer", async () => {
		const test = newContainer();
		await seedSnippet(test);
		const insert = vi.fn();
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openPicker(insert));

		expect(await screen.findByText("Review")).toBeTruthy();
		const search = screen.getByPlaceholderText("Search snippets...");
		fireEvent.change(search, { target: { value: "zzzz" } });
		expect(await screen.findByText("No snippets found")).toBeTruthy();

		fireEvent.change(search, { target: { value: "rev" } });
		fireEvent.click(await screen.findByText("Review"));
		expect(insert).toHaveBeenCalledWith("Review this change.");
	});

	it("says when there are no saved snippets, and opens Create snippet", async () => {
		const test = newContainer();
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openPicker(vi.fn()));
		expect(await screen.findByText("No saved snippets yet.")).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "Create snippet" }));
		expect(await screen.findByRole("dialog", { name: "Create snippet" })).toBeTruthy();
	});

	it("shows a failed read's message", async () => {
		const test = newContainer();
		test.container.services.composer.store.setState({
			snippets: null,
			snippetError: appError("db", "The snippets could not be read."),
		});
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openPicker(vi.fn()));
		expect(await screen.findByText(/Couldn't load snippets\./)).toBeTruthy();
	});
});

describe("COMP-09 snippet dialogs", () => {
	it("creates a snippet from the Name, Keyword and Prompt snippet fields", async () => {
		const test = newContainer();
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openCreate());
		await screen.findByRole("dialog", { name: "Create snippet" });

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fix errors" } });
		fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "fix" } });
		fireEvent.change(screen.getByLabelText("Prompt snippet"), {
			target: { value: "Fix the errors." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(test.container.services.composer.store.getState().snippets).toEqual([
				expect.objectContaining({ name: "Fix errors", keyword: "fix", prompt: "Fix the errors." }),
			]),
		);
	});

	it("saves the create form with Cmd+Enter", async () => {
		const test = newContainer();
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openCreate());
		const dialog = await screen.findByRole("dialog", { name: "Create snippet" });
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Summarise" } });
		fireEvent.change(screen.getByLabelText("Prompt snippet"), {
			target: { value: "Summarise the change." },
		});
		fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });

		await waitFor(() =>
			expect(test.container.services.composer.store.getState().snippets).toEqual([
				expect.objectContaining({ name: "Summarise" }),
			]),
		);
	});

	it("says Couldn't save snippet when the keyword is already used", async () => {
		const test = newContainer();
		await seedSnippet(test, "Review", "rev");
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openCreate());
		await screen.findByRole("dialog", { name: "Create snippet" });

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Again" } });
		fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "rev" } });
		fireEvent.change(screen.getByLabelText("Prompt snippet"), { target: { value: "Again." } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't save snippet", expect.anything()),
		);
	});

	it("edits and deletes a snippet from Edit snippets", async () => {
		const test = newContainer();
		await seedSnippet(test);
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openEdit());
		await screen.findByRole("dialog", { name: "Edit snippets" });

		fireEvent.click(await screen.findByRole("button", { name: "Edit Review" }));
		await screen.findByRole("dialog", { name: "Edit snippet" });
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Reviewed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Reviewed")).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "Delete Reviewed" }));
		await waitFor(() => expect(screen.queryByText("Reviewed")).toBeNull());
	});

	it("says Couldn't delete snippet when the delete fails", async () => {
		const test = newContainer();
		const snippet = await seedSnippet(test);
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		vi.spyOn(test.container.actions.snippets, "remove").mockResolvedValue(
			err(appError("db", "The snippet could not be deleted.")),
		);
		renderOverlays(test);
		act(() => useSnippetDialogsStore.getState().openEdit());
		fireEvent.click(await screen.findByRole("button", { name: `Delete ${snippet.name}` }));

		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith("Couldn't delete snippet", expect.anything()),
		);
	});
});

describe("COMP-09 composer snippets", () => {
	async function mountComposer(onEditorReady?: (editor: Editor | null) => void) {
		const test = newContainer();
		const workspace = await seedWorkspace(test.container);
		const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		test.container.services.sessions.store.setState((state) => ({
			...state,
			viewingSessionId: session.id,
		}));
		render(
			<ServicesProvider container={test.container}>
				<CommandDispatcher>
					<Composer
						workspaceId={workspace.id}
						sessionId={session.id}
						{...(onEditorReady === undefined ? {} : { onEditorReady })}
					/>
					<SnippetOverlays />
				</CommandDispatcher>
			</ServicesProvider>,
		);
		return { test, workspace, session };
	}

	it("offers Add snippet and Insert snippet in the '+' menu", async () => {
		const { test } = await mountComposer();
		await seedSnippet(test);
		await openPlusMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Add snippet/ }));
		expect(await screen.findByRole("dialog", { name: "Create snippet" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "Create snippet" })).toBeNull(),
		);
		await openPlusMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Insert snippet/ }));
		expect(await screen.findByPlaceholderText("Search snippets...")).toBeTruthy();
	});

	it("inserts a chosen snippet into the editor from the '+' menu", async () => {
		const { test } = await mountComposer();
		await seedSnippet(test);
		await openPlusMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Insert snippet/ }));
		fireEvent.click(await screen.findByText("Review"));
		await waitFor(() =>
			expect(screen.getByLabelText("composer").textContent).toContain("Review this change."),
		);
	});

	it("keeps a multi-line prompt's line breaks from the '+' menu and from the § trigger", async () => {
		let editor: Editor | null = null;
		const { test } = await mountComposer((next) => {
			editor = next;
		});
		const prompt = "Review this change.\nThen run the tests.";
		await seedSnippet(test, "Review", "rev", prompt);
		const send = vi.spyOn(test.container.actions.sessions, "send");
		await waitFor(() => expect(editor).not.toBeNull());
		const current = () => editor as unknown as Editor;

		await openPlusMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Insert snippet/ }));
		fireEvent.click(await screen.findByText("Review"));
		await waitFor(() => expect(current().getText()).toBe(prompt));

		act(() => current().commands.setContent(""));
		act(() => current().commands.insertContent("§rev"));
		await screen.findByRole("listbox", { name: "Snippets" });
		fireEvent.keyDown(screen.getByRole("textbox", { name: "composer" }), { key: "Enter" });

		await waitFor(() => expect(current().getText()).toBe(prompt));
		expect(send).not.toHaveBeenCalled();
	});

	it("inserts a prompt with angle brackets as plain text from the '+' menu", async () => {
		let editor: Editor | null = null;
		const { test } = await mountComposer((next) => {
			editor = next;
		});
		const prompt = "Wrap the list in <ul> tags & keep <b>bold</b> as typed.";
		await seedSnippet(test, "Review", "rev", prompt);
		await waitFor(() => expect(editor).not.toBeNull());

		await openPlusMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Insert snippet/ }));
		fireEvent.click(await screen.findByText("Review"));

		await waitFor(() => expect((editor as unknown as Editor).getText()).toBe(prompt));
	});

	it("opens the snippet picker on Cmd+;", async () => {
		await mountComposer();
		const editor = await screen.findByLabelText("composer");
		fireEvent.keyDown(editor, { key: ";", metaKey: true });
		expect(await screen.findByPlaceholderText("Search snippets...")).toBeTruthy();
	});
});

describe("COMP-09 palette actions", () => {
	async function openPalette(): Promise<TestContainer> {
		const test = newContainer();
		await test.container.services.settings.start();
		const repo = await seedRepo(test.container, { name: "conducted" });
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "fix-login",
		});
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
		act(() => useOverlayStore.getState().show("palette"));
		return test;
	}

	it("opens Create snippet from the palette", async () => {
		await openPalette();
		const input = await screen.findByPlaceholderText("Type a command or search...");
		fireEvent.change(input, { target: { value: "create snippet" } });
		fireEvent.click(await screen.findByText("Create snippet"));
		expect(await screen.findByRole("dialog", { name: "Create snippet" })).toBeTruthy();
	});

	it("opens Edit snippets from the palette", async () => {
		await openPalette();
		const input = await screen.findByPlaceholderText("Type a command or search...");
		fireEvent.change(input, { target: { value: "edit snippets" } });
		fireEvent.click(await screen.findByText("Edit snippets"));
		expect(await screen.findByRole("dialog", { name: "Edit snippets" })).toBeTruthy();
	});
});

describe("COMP-09 snippet dialog store", () => {
	it("leaves no insert callback when the palette opens the picker, and drops one on close", () => {
		useSnippetDialogsStore.getState().openPicker();
		expect(useSnippetDialogsStore.getState().mode).toBe("picker");
		expect(useSnippetDialogsStore.getState().insert).toBeNull();

		const insert = vi.fn();
		useSnippetDialogsStore.getState().openPicker(insert);
		expect(useSnippetDialogsStore.getState().insert).toBe(insert);
		useSnippetDialogsStore.getState().close();
		expect(useSnippetDialogsStore.getState().insert).toBeNull();
	});

	it("returns a saved create form to the picker or the edit list", () => {
		useSnippetDialogsStore.getState().openCreate("picker");
		useSnippetDialogsStore.getState().finishCreate();
		expect(useSnippetDialogsStore.getState().mode).toBe("picker");

		useSnippetDialogsStore.getState().openCreate("edit");
		useSnippetDialogsStore.getState().finishCreate();
		expect(useSnippetDialogsStore.getState().mode).toBe("edit");
	});
});
