/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the journey through the app's own root, the real container, the in-memory Platform and a
 * scripted Worker: on a paired Mac, choose the cloud entry in the sidebar's switcher, create two
 * cloud workspaces from the new-workspace page, and see each saved with a cloud host, opened, and
 * its first chat started on the Worker; and that switching back reopens the workspace that was
 * open in that entry.
 * Behaviour: issue #491 and Conductor 0.92.1's flow (the switcher's cloud organisation makes the
 * new-workspace page create in the cloud, renderApp `BXa`, main `aV`).
 * Test first: on a paired Mac the cloud entry creates two cloud workspaces from the new-workspace
 * page, each opened with its first chat on the Worker.
 */
import { ok, type Result } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import type { Workspace } from "../core/model.ts";
import { scriptWorker } from "../test/cloud-worker.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { toast } from "../ui/Toast.tsx";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

const WORKER = "https://conducted.example.workers.dev";

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

let open: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	toast.dismiss();
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
});

/** Creates one workspace from the new-workspace page, opened from the sidebar's Create row. */
async function createFromPage(
	router: ReturnType<typeof createAppRouter>,
	prompt: string,
): Promise<string> {
	const nav = screen.getByRole("navigation", { name: "Main" });
	fireEvent.click(within(nav).getByRole("link", { name: /Create/ }));
	const dialog = await screen.findByRole("dialog");
	const picker = await within(dialog).findByRole("button", { name: "Repository" });
	expect(picker.textContent).toContain("api");
	fireEvent.change(within(dialog).getByLabelText("First message"), { target: { value: prompt } });
	const create = within(dialog).getByRole("button", { name: "Create workspace" });
	await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(create);
	await waitFor(() => expect(router.state.location.pathname).toMatch(/\/workspace\/[^/]+$/), {
		timeout: 5_000,
	});
	return router.state.location.pathname.split("/").pop() ?? "";
}

describe("CLOUD-19 creating cloud workspaces from the app", () => {
	it("on a paired Mac the cloud entry creates two cloud workspaces from the new-workspace page, each opened with its first chat on the Worker", async () => {
		const test = createTestContainer();
		open = test;
		const { services } = test.container;
		test.memory.controls.scriptShell((command) => {
			if (command.program === "lsof") return ok({ stdout: "", stderr: "", exitCode: 1 });
			if (command.program !== "git") return null;
			if (command.args.includes("show-ref")) return ok({ stdout: "", stderr: "", exitCode: 1 });
			return ok({ stdout: "", stderr: "", exitCode: 0 });
		});
		const worker = scriptWorker(test);
		must(await services.settings.start());
		must(await services.cloudPairing.start());
		must(await test.container.sidecar.start());
		const repo = await seedRepo(test.container, {
			name: "api",
			remoteUrl: "git@github.com:acme/api.git",
		});
		must(await services.workspace.start());

		const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
						<RouterProvider router={router} />
					</VirtuosoMockContext.Provider>
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();

		// Choose the Worker in the sidebar's switcher.
		fireEvent.keyDown(await screen.findByRole("button", { name: "Account menu" }), {
			key: "Enter",
		});
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /conducted\.example\.workers\.dev/ }),
		);
		await waitFor(() => expect(services.settings.get("active_organization")).toBe("cloud"));

		const firstId = await createFromPage(router, "Fix the login bug");
		const secondId = await createFromPage(router, "Add a health route");
		expect(firstId).not.toBe(secondId);

		const saved = services.workspace.store.getState().workspacesById;
		const created = [firstId, secondId].map((id) => saved[id] as Workspace);
		for (const workspace of created) {
			expect(workspace.repoId).toBe(repo.id);
			expect(workspace.state).toBe("ready");
			expect(workspace.host).toMatchObject({ kind: "cloud", url: WORKER });
		}
		const vmIds = created.map((workspace) =>
			workspace.host.kind === "cloud" ? workspace.host.vmId : "",
		);
		expect(new Set(vmIds).size).toBe(2);
		expect(router.state.location.pathname).toBe(`/repository/${repo.id}/workspace/${secondId}`);

		// Each first chat started on its own sandbox's sidecar, through the Worker.
		await waitFor(() =>
			expect(
				worker.relayCalls
					.filter((call) => call.method === "sendMessage")
					.map((call) => call.vmId)
					.sort(),
			).toEqual([...vmIds].sort()),
		);
		const sentTexts = worker.relayCalls
			.filter((call) => call.method === "sendMessage")
			.map((call) => JSON.stringify(call.params));
		expect(sentTexts.some((text) => text.includes("Fix the login bug"))).toBe(true);
		expect(sentTexts.some((text) => text.includes("Add a health route"))).toBe(true);
		expect(test.memory.controls.shellCalls.some((call) => call.args.includes("worktree"))).toBe(
			false,
		);
	});

	it("switching back reopens the workspace that was open in that entry", async () => {
		const test = createTestContainer();
		open = test;
		const { services } = test.container;
		scriptWorker(test);
		must(await services.settings.start());
		must(await services.cloudPairing.start());
		const repo = await seedRepo(test.container, { name: "api" });
		const local = await seedWorkspace(test.container, { repoId: repo.id, directoryName: "oslo" });
		const cloud = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "lisbon",
			path: "/workspace/ws-lisbon",
			host: { kind: "cloud", url: WORKER, vmId: "ws-lisbon" },
		});
		const localPath = `/repository/${repo.id}/workspace/${local.id}`;
		const cloudPath = `/repository/${repo.id}/workspace/${cloud.id}`;
		const router = createAppRouter(createMemoryHistory({ initialEntries: [localPath] }));
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
						<RouterProvider router={router} />
					</VirtuosoMockContext.Provider>
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();
		const choose = async (name: RegExp) => {
			fireEvent.keyDown(await screen.findByRole("button", { name: "Account menu" }), {
				key: "Enter",
			});
			fireEvent.click(await screen.findByRole("menuitem", { name }));
		};

		// The Worker has no remembered workspace yet, so the screen stays where it is.
		await choose(/conducted\.example\.workers\.dev/);
		await waitFor(() => expect(services.settings.get("active_organization")).toBe("cloud"));
		expect(router.state.location.pathname).toBe(localPath);

		await router.navigate({ to: cloudPath });
		await choose(/My Mac/);
		await waitFor(() => expect(router.state.location.pathname).toBe(localPath));
		await choose(/conducted\.example\.workers\.dev/);
		await waitFor(() => expect(router.state.location.pathname).toBe(cloudPath));
	});
});
