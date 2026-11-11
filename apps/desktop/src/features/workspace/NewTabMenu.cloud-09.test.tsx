// @vitest-environment jsdom
/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests the new-tab menu's terminal item in a cloud workspace through the real container: it says
 * "Cloud terminal" and opens a sandbox terminal, where a Mac workspace says "Local terminal".
 * Behaviour: ui-map.md 3.2 (the '+' menu names the host of its terminal).
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { NewTabMenu } from "./NewTabMenu.tsx";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

let test: TestContainer;

beforeEach(async () => {
	test = createTestContainer();
	// The app loads settings before any screen shows; a new terminal waits for them.
	expect((await test.container.services.settings.start()).ok).toBe(true);
});

afterEach(() => {
	cleanup();
	test.close();
});

async function seed(host: Host): Promise<Workspace> {
	const workspace = await seedWorkspace(test.container, { host });
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	test.memory.controls.scriptCloud((request) =>
		request.path === "/w/vm-1/files" &&
		(request.body as { operation?: string }).operation === "exists"
			? ok({ status: 200, body: JSON.stringify({ exists: true }) })
			: null,
	);
	return workspace;
}

async function openMenu(workspaceId: Workspace["id"]): Promise<void> {
	render(
		<ServicesProvider container={test.container}>
			<NewTabMenu workspaceId={workspaceId} atTabLimit={false} onSearchChange={() => {}} />
		</ServicesProvider>,
	);
	const trigger = screen.getByRole("button", { name: "New tab" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
	await screen.findByRole("menu");
}

describe("CLOUD-09 the new-tab menu's terminal", () => {
	it("offers and opens a Cloud terminal in a cloud workspace", async () => {
		const workspace = await seed(CLOUD);
		await openMenu(workspace.id);
		expect(screen.queryByRole("menuitem", { name: "Local terminal" })).toBeNull();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Cloud terminal" }));
		await waitFor(() =>
			expect(
				Object.values(test.memory.controls.cloudRelayChannels).filter(
					(channel) => channel === "terminal",
				),
			).toHaveLength(1),
		);
	});

	it("keeps Local terminal in a Mac workspace", async () => {
		const workspace = await seed({ kind: "local" });
		await openMenu(workspace.id);
		expect(await screen.findByRole("menuitem", { name: "Local terminal" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Cloud terminal" })).toBeNull();
	});
});
