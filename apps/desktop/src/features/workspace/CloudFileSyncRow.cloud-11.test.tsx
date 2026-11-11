/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the header popover's "Sync files" row through the real container: its Conductor wording,
 * the workspace's mirror switch, and the file list the switch asks the Worker for.
 * Test first: shows Conductor's words and turns the workspace's mirror on and off.
 */

import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { CloudFileSyncRow } from "./CloudFileSyncRow.tsx";

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

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
});
