/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the header popover's "Sync files" row through the real container: its Conductor wording,
 * the workspace's mirror switch, the file list the switch asks the Worker for, the switch kept
 * across a restart of the app over the same database, and Conductor's toasts when the switch
 * fails.
 * Test first: shows Conductor's words and turns the workspace's mirror on and off.
 */

import type { Host } from "@conducted/protocol";
import { ok, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { WORKSPACES_SQL } from "../../core/db/workspaces.ts";
import type { Database } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { failingOnExecute } from "../../test/failing-database.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { CloudFileSyncRow } from "./CloudFileSyncRow.tsx";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "oslo" };
type TestContainer = ReturnType<typeof createTestContainer>;

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	toast.dismiss();
	for (const test of containers.splice(0)) test.close();
});

/** Answers the Worker's file list with an empty sandbox, so a sync that starts succeeds. */
function scriptEmptySandbox(test: TestContainer): void {
	test.memory.controls.scriptCloud((request) =>
		request.path.endsWith("/files")
			? ok({ status: 200, body: JSON.stringify({ entries: [], truncated: false }) })
			: null,
	);
}

function renderRow(test: TestContainer, workspaceId: WorkspaceId): void {
	render(
		<ServicesProvider container={test.container}>
			<CloudFileSyncRow workspaceId={workspaceId} />
			<Toaster />
		</ServicesProvider>,
	);
}

/**
 * A ready cloud workspace made while the Advanced setting was `autoSync`, so its saved switch
 * starts there, as a create writes it. Its row is shown.
 */
async function shownWorkspace(autoSync: boolean) {
	const test = createTestContainer();
	containers.push(test);
	const set = await test.container.services.settings.set(
		"auto_sync_files_in_new_cloud_workspaces",
		autoSync,
	);
	expect(set.ok).toBe(true);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		host: CLOUD,
		remoteFileSyncEnabled: autoSync,
	});
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	expect((await test.container.services.workspace.start()).ok).toBe(true);
	scriptEmptySandbox(test);
	renderRow(test, workspace.id);
	return { test, workspace };
}

/**
 * Quits the app and opens it again over the same database, then shows the row once more. `wrap`
 * makes the restarted app's database fail one statement.
 */
async function restart(
	first: TestContainer,
	workspaceId: WorkspaceId,
	wrap?: (database: Database) => Database,
): Promise<TestContainer> {
	cleanup();
	await first.container.stop();
	const second = createTestContainer({ restartOver: first.database, wrapDatabase: wrap });
	containers.push(second);
	expect((await second.container.services.settings.start()).ok).toBe(true);
	expect((await second.container.services.workspace.start()).ok).toBe(true);
	scriptEmptySandbox(second);
	renderRow(second, workspaceId);
	return second;
}

/** The restarted app's database, whose save of the Sync files switch fails. */
const failingSwitchSave = (database: Database): Database =>
	failingOnExecute(database, WORKSPACES_SQL.setRemoteFileSyncEnabled, new Error("disk I/O error"));

async function setup() {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		host: { kind: "cloud", url: "https://w.example.dev", vmId: "oslo" },
	});
	await test.container.services.settings.set("auto_sync_files_in_new_cloud_workspaces", false);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	test.memory.controls.scriptCloud((request) =>
		request.path.endsWith("/files")
			? ok({ status: 200, body: JSON.stringify({ entries: [], truncated: false }) })
			: null,
	);
	render(
		<ServicesProvider container={test.container}>
			<CloudFileSyncRow workspaceId={workspace.id} />
		</ServicesProvider>,
	);
	return { test, workspace };
}

describe("CLOUD-11 Sync files row", () => {
	it("shows Conductor's words and turns the workspace's mirror on and off", async () => {
		const { test, workspace } = await setup();
		expect(await screen.findByText("Sync files")).toBeTruthy();
		expect(screen.getByText("Sync to a local directory")).toBeTruthy();
		expect(screen.getByText("Local folder")).toBeTruthy();
		fireEvent.click(screen.getByRole("switch", { name: "Turn on remote file sync" }));
		await waitFor(() =>
			expect(screen.getByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy(),
		);
		await waitFor(() =>
			expect(
				test.memory.controls.cloudRequests.some((request) => request.path.endsWith("/files")),
			).toBe(true),
		);
		expect(
			test.container.services.cloudFileSync.viewOf(workspace.id, workspace.host),
		).toMatchObject({ state: "synced" });
		fireEvent.click(screen.getByRole("switch", { name: "Turn off remote file sync" }));
		await waitFor(() =>
			expect(screen.getByRole("switch", { name: "Turn on remote file sync" })).toBeTruthy(),
		);
		expect(
			test.container.services.cloudFileSync.viewOf(workspace.id, workspace.host),
		).toMatchObject({ state: "off" });
	});

	it("keeps the switch off after the app restarts", async () => {
		const { test, workspace } = await shownWorkspace(true);
		fireEvent.click(await screen.findByRole("switch", { name: "Turn off remote file sync" }));
		await waitFor(() =>
			expect(screen.getByRole("switch", { name: "Turn on remote file sync" })).toBeTruthy(),
		);

		const restarted = await restart(test, workspace.id);

		expect(await screen.findByRole("switch", { name: "Turn on remote file sync" })).toBeTruthy();
		expect(restarted.container.services.cloudFileSync.isEnabled(workspace.id)).toBe(false);
	});

	it("keeps the switch on after the app restarts while new workspaces start without sync", async () => {
		const { test, workspace } = await shownWorkspace(false);
		fireEvent.click(await screen.findByRole("switch", { name: "Turn on remote file sync" }));
		await waitFor(() =>
			expect(screen.getByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy(),
		);

		const restarted = await restart(test, workspace.id);

		expect(await screen.findByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy();
		expect(restarted.container.services.cloudFileSync.isEnabled(workspace.id)).toBe(true);
	});

	it("shows Conductor's toast and keeps the switch on when saving it off fails", async () => {
		const { test, workspace } = await shownWorkspace(true);
		await screen.findByRole("switch", { name: "Turn off remote file sync" });
		const restarted = await restart(test, workspace.id, failingSwitchSave);

		fireEvent.click(await screen.findByRole("switch", { name: "Turn off remote file sync" }));

		expect(
			await screen.findByText(
				"Failed to update sync preference: Saving the Sync files switch failed",
			),
		).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy();
		expect(restarted.container.services.cloudFileSync.isEnabled(workspace.id)).toBe(true);
	});

	it("shows Conductor's start toast and keeps the switch off when saving it on fails", async () => {
		const { test, workspace } = await shownWorkspace(false);
		await screen.findByRole("switch", { name: "Turn on remote file sync" });
		const restarted = await restart(test, workspace.id, failingSwitchSave);

		fireEvent.click(await screen.findByRole("switch", { name: "Turn on remote file sync" }));

		expect(
			await screen.findByText("Failed to start file sync: Saving the Sync files switch failed"),
		).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Turn on remote file sync" })).toBeTruthy();
		expect(restarted.container.services.cloudFileSync.isEnabled(workspace.id)).toBe(false);
		expect(
			restarted.memory.controls.cloudRequests.some((request) => request.path.endsWith("/files")),
		).toBe(false);
	});

	it("shows Conductor's start toast when the first sync fails, and keeps the switch on", async () => {
		const { test, workspace } = await shownWorkspace(false);
		// The Worker refuses the file list, so the sync the switch starts fails.
		test.memory.controls.scriptCloud((request) =>
			request.path.endsWith("/files")
				? ok({ status: 500, body: JSON.stringify({ error: "The sandbox is stopped." }) })
				: null,
		);
		fireEvent.click(await screen.findByRole("switch", { name: "Turn on remote file sync" }));

		expect(
			await screen.findByText("Failed to start file sync: The sandbox is stopped."),
		).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy();
		const restarted = await restart(test, workspace.id);
		expect(await screen.findByRole("switch", { name: "Turn off remote file sync" })).toBeTruthy();
		expect(restarted.container.services.cloudFileSync.isEnabled(workspace.id)).toBe(true);
	});
});
