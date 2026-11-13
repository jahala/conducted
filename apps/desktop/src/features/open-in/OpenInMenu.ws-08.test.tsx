/**
 * @feature WS-08 OpenInMenu
 * Owns: tests for the workspace header's Open in control: its default app, menu order, fallback,
 * archived state, failure toast, default setting, its two shortcuts and its Copy path item.
 * Behaviour: ui-map.md 3.10; services-map.md 4.2.3.
 * Test first: with Cursor and Finder installed and Cursor last used, the button label is Cursor
 * and the menu lists Cursor first.
 */
import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { OpenInMenu } from "./OpenInMenu.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

interface SetupOptions {
	installed?: string[];
	defaultApp?: string;
	recents?: string;
}

async function setup(options: SetupOptions = {}) {
	test = createTestContainer();
	const repo = await seedRepo(test.container, { name: "project-alpha" });
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	test.container.services.settings.store.setState({
		values: {
			default_open_in: options.defaultApp ?? "",
			open_in_mru_order: options.recents ?? "",
		},
	});
	const installedApps = vi
		.spyOn(test.container.platform.opener, "installedApps")
		.mockResolvedValue(options.installed ?? ["Finder", "Cursor"]);
	return { workspace, installedApps };
}

function renderMenu(workspaceId: WorkspaceId, dispatcher = false) {
	if (test === undefined) throw new Error("Create the test container first.");
	const menu = <OpenInMenu workspaceId={workspaceId} />;
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				{dispatcher ? <CommandDispatcher>{menu}</CommandDispatcher> : menu}
			</AppProviders>
		</ServicesProvider>,
	);
}

async function openMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Open in menu" }));
	return screen.findByRole("menu");
}

const menuLabels = (menu: HTMLElement) =>
	within(menu)
		.getAllByRole("menuitem")
		.map((item) => item.textContent);

describe("WS-08 OpenInMenu", () => {
	it("WS-08 labels the button with the last used app and lists it first", async () => {
		const { workspace } = await setup({ installed: ["Finder", "Cursor"], recents: "Cursor" });
		renderMenu(workspace.id);

		expect(await screen.findByRole("button", { name: /Cursor/ })).toBeTruthy();
		const menu = await openMenu();
		// The apps come first, then Conductor's "Copy path" (D098).
		expect(menuLabels(menu)).toEqual(["Cursor", "Finder", "Copy path"]);
	});

	it("WS-08 shows the default app's own icon, and the app's kind for an app with no icon", async () => {
		const { workspace } = await setup({ installed: ["Finder", "Cursor"], recents: "Cursor" });
		if (test === undefined) throw new Error("Create the test container first.");
		const cursorIcon = "data:image/png;base64,iVBORw0KGgo=";
		const appIcon = vi
			.spyOn(test.container.platform.opener, "appIcon")
			.mockImplementation(async (appName) => ok(appName === "Cursor" ? cursorIcon : null));
		renderMenu(workspace.id);

		const button = await screen.findByRole("button", { name: "Open in Cursor" });
		const icon = await within(button).findByRole("img", { name: "Cursor icon" });
		expect(icon.getAttribute("src")).toBe(cursorIcon);
		expect(appIcon).toHaveBeenCalledWith("Cursor");

		const menu = await openMenu();
		const finder = within(menu).getByRole("menuitem", { name: /Finder/ });
		await waitFor(() => expect(appIcon).toHaveBeenCalledWith("Finder"));
		expect(within(finder).queryByRole("img")).toBeNull();
		expect(finder.querySelector("svg")).not.toBeNull();
		expect(
			await within(within(menu).getByRole("menuitem", { name: /Cursor/ })).findByRole("img", {
				name: "Cursor icon",
			}),
		).toBeTruthy();
	});

	it("WS-08 opens the default app and remembers it as the most recent", async () => {
		const { workspace } = await setup({ installed: ["Finder", "Cursor"], recents: "" });
		if (test === undefined) throw new Error("Create the test container first.");
		const openIn = vi
			.spyOn(test.container.actions.workspaces, "openIn")
			.mockResolvedValue(ok(undefined));
		const set = vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(ok(undefined));
		renderMenu(workspace.id);

		fireEvent.click(await screen.findByRole("button", { name: /Finder/ }));

		await waitFor(() => expect(openIn).toHaveBeenCalledWith(workspace.id, "Finder"));
		await waitFor(() => expect(set).toHaveBeenCalledWith("open_in_mru_order", "Finder"));
	});

	it("WS-08 sets an app as the default from the menu", async () => {
		const { workspace } = await setup({ installed: ["Finder", "Cursor"], recents: "Cursor" });
		if (test === undefined) throw new Error("Create the test container first.");
		const set = vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(ok(undefined));
		renderMenu(workspace.id);

		await screen.findByRole("button", { name: /Cursor/ });
		await openMenu();
		fireEvent.click(screen.getByRole("button", { name: "Set as default" }));

		await waitFor(() => expect(set).toHaveBeenCalledWith("default_open_in", "Finder"));
	});

	it("WS-08 falls back to the first available app when the default is gone", async () => {
		const { workspace } = await setup({
			installed: ["Finder", "Zed"],
			defaultApp: "Cursor",
		});
		renderMenu(workspace.id);

		expect(await screen.findByRole("button", { name: /Finder/ })).toBeTruthy();
		const menu = await openMenu();
		expect(menuLabels(menu)).toEqual(["Finder", "Zed", "Copy path"]);
		expect(screen.getAllByRole("button", { name: "Set as default" })).toHaveLength(1);
	});

	it("WS-08 keeps Finder alone when no editor or terminal is installed", async () => {
		const { workspace } = await setup({ installed: [] });
		renderMenu(workspace.id);

		await screen.findByRole("button", { name: /Finder/ });
		const menu = await openMenu();
		expect(menuLabels(menu)).toEqual(["Finder", "Copy path"]);
	});

	it("WS-08 disables the control with a reason for an archived workspace", async () => {
		const { workspace } = await setup();
		if (test === undefined) throw new Error("Create the test container first.");
		test.container.services.workspace.store.setState((state) => ({
			workspacesById: {
				...state.workspacesById,
				[workspace.id]: { ...workspace, state: "archived", archivedAt: 10 },
			},
		}));
		renderMenu(workspace.id);

		const main = await screen.findByRole("button", { name: /Finder/ });
		expect((main as HTMLButtonElement).disabled).toBe(true);
		expect(main.getAttribute("title")).toBe("This workspace is archived.");
	});

	it("WS-08 says the workspace is still loading when its app is pressed before it loads", async () => {
		const { workspace } = await setup({
			installed: ["Finder", "Cursor"],
			defaultApp: "Cursor",
			recents: "Cursor",
		});
		if (test === undefined) throw new Error("Create the test container first.");
		const openIn = vi.spyOn(test.container.actions.workspaces, "openIn");
		test.container.services.workspace.store.setState({ loaded: false });
		renderMenu(workspace.id);

		fireEvent.click(await screen.findByRole("button", { name: /Cursor/ }));

		expect(await screen.findByText("Workspace is still loading, try again")).toBeTruthy();
		expect(openIn).not.toHaveBeenCalled();
	});

	it("WS-08 shows the toast title when the app cannot open the path", async () => {
		const { workspace } = await setup({
			installed: ["Finder", "Cursor"],
			defaultApp: "Cursor",
			recents: "Cursor",
		});
		if (test === undefined) throw new Error("Create the test container first.");
		vi.spyOn(test.container.actions.workspaces, "openIn").mockResolvedValue(
			err(appError("open_with_missing_path", "The folder is gone.")),
		);
		renderMenu(workspace.id);

		fireEvent.click(await screen.findByRole("button", { name: /Cursor/ }));

		expect(await screen.findByText("This app can't open this path")).toBeTruthy();
	});

	it("WS-08 opens the default app with Cmd+O and the menu with Cmd+Shift+O", async () => {
		const { workspace } = await setup({
			installed: ["Finder", "Cursor"],
			defaultApp: "Cursor",
			recents: "Cursor",
		});
		if (test === undefined) throw new Error("Create the test container first.");
		const openIn = vi
			.spyOn(test.container.actions.workspaces, "openIn")
			.mockResolvedValue(ok(undefined));
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(ok(undefined));
		renderMenu(workspace.id, true);
		await screen.findByRole("button", { name: /Cursor/ });

		fireEvent.keyDown(document, { key: "o", metaKey: true });
		await waitFor(() => expect(openIn).toHaveBeenCalledWith(workspace.id, "Cursor"));

		fireEvent.keyDown(document, { key: "o", metaKey: true, shiftKey: true });
		expect(await screen.findByRole("menu")).toBeTruthy();
	});

	it("WS-08 opens the menu with Cmd+O when no default app is set", async () => {
		const { workspace } = await setup({ installed: ["Finder", "Cursor"], recents: "" });
		if (test === undefined) throw new Error("Create the test container first.");
		const openIn = vi
			.spyOn(test.container.actions.workspaces, "openIn")
			.mockResolvedValue(ok(undefined));
		renderMenu(workspace.id, true);
		await screen.findByRole("button", { name: /Finder/ });

		fireEvent.keyDown(document, { key: "o", metaKey: true });

		expect(await screen.findByRole("menu")).toBeTruthy();
		expect(openIn).not.toHaveBeenCalled();
	});
	it("WS-08 copies the workspace folder path from the menu's last item", async () => {
		const { workspace } = await setup();
		if (test === undefined) throw new Error("Create the test container first.");
		const copied = vi.spyOn(test.container.platform.clipboard, "writeText");
		renderMenu(workspace.id);

		await screen.findByRole("button", { name: /Cursor|Finder/ });
		const menu = await openMenu();
		fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy path" }));
		await waitFor(() => expect(copied).toHaveBeenCalledWith(workspace.path));
	});
});
