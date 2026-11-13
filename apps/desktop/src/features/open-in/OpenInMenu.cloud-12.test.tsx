/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Tests the Open in control on a cloud workspace: it reads "Open via SSH", lists only VS Code,
 * Cursor and Zed, adds Conductor's "Copy SSH command", and Cmd+Alt+O opens the menu when no
 * default remote editor is set.
 * Test first: a cloud workspace's menu does not list Finder or Ghostty.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const CLOUD = {
	kind: "cloud" as const,
	url: "https://w.example.dev",
	vmId: "vm-1",
};

async function setup() {
	test = createTestContainer();
	const repo = await seedRepo(test.container, { name: "project-alpha" });
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		directoryName: "oslo",
		branch: "jahala/oslo",
		path: "/workspace/oslo",
		host: CLOUD,
	});
	test.container.services.settings.store.setState({
		values: { default_open_in: "", open_in_mru_order: "" },
	});
	test.memory.platform.opener.installedApps = async () => [
		"Finder",
		"Cursor",
		"Visual Studio Code",
		"Zed",
		"Ghostty",
	];
	return { workspace };
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

describe("CLOUD-12 Open in on a cloud workspace", () => {
	it("reads Open via SSH and lists only the three remote editors plus Copy SSH command", async () => {
		const { workspace } = await setup();
		renderMenu(workspace.id);

		expect(await screen.findByRole("button", { name: "Open via SSH" })).toBeTruthy();
		const menu = await openMenu();
		expect(menuLabels(menu)).toEqual([
			"Cursor",
			"Visual Studio Code",
			"Zed",
			"Copy SSH command",
			"Copy path",
		]);
	});

	it("says No apps available when none of the three remote editors is installed", async () => {
		const { workspace } = await setup();
		if (test === undefined) throw new Error("No container.");
		test.memory.platform.opener.installedApps = async () => ["Finder", "Ghostty"];
		renderMenu(workspace.id);

		const menu = await openMenu();

		expect(await within(menu).findByText("No apps available")).toBeTruthy();
		expect(menuLabels(menu)).toEqual(["Copy SSH command", "Copy path"]);
	});

	it("opens the menu with Cmd+Alt+O when no default remote editor is set", async () => {
		const { workspace } = await setup();
		if (test === undefined) throw new Error("Create the test container first.");
		const copySsh = vi
			.spyOn(test.container.actions.workspaces, "copySshCommand")
			.mockResolvedValue(ok("ssh oslo.conducted"));
		renderMenu(workspace.id, true);
		await screen.findByRole("button", { name: "Open via SSH" });

		fireEvent.keyDown(document, { key: "o", metaKey: true, altKey: true });

		expect(await screen.findByRole("menu")).toBeTruthy();
		expect(copySsh).not.toHaveBeenCalled();
	});
});
