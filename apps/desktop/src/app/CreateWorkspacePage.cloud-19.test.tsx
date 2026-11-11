/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: tests of the new-workspace page while the cloud entry is active, over the real container
 * and a scripted Worker: the repository picker lists the projects the Worker can clone, the create
 * call names the Worker, and each launch-disabled state shows Conductor's words with Create off.
 * Behaviour: renderApp `BXa` @11497335 (the hosting target, the machine repository picker, the
 * branch picker hidden, "Checking organization...", the data-privacy text) and `RYa`, `OYa`,
 * `AYa` (the readiness reasons and the top row's status line).
 * Test first: with the cloud entry active the page offers the Worker's repositories and creates
 * there.
 */
import { ok, type Result } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewWorkspaceInput } from "../core/api.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Workspace } from "../core/model.ts";
import type { CloudReadiness } from "../core/organization.ts";
import { scriptWorker } from "../test/cloud-worker.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../test/container.ts";
import { CreateWorkspacePage } from "./CreateWorkspacePage.tsx";

const WORKER = "https://conducted.example.workers.dev";

let test: TestContainer | null = null;

afterEach(() => {
	cleanup();
	test?.close();
	test = null;
});

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

/**
 * The page on a paired Mac with the cloud entry active. `pairingRead` false leaves the pairing
 * unread, as at the start of the app.
 */
async function renderCloudPage(
	options: { readiness?: CloudReadiness; dataPrivacy?: boolean; pairingRead?: boolean } = {},
) {
	test = createTestContainer();
	const { services, actions } = test.container;
	must(await services.settings.start());
	must(await services.settings.set("active_organization", "cloud"));
	if (options.dataPrivacy === true)
		must(await services.settings.set("enterprise_data_privacy", true));
	scriptWorker(test, options.readiness === undefined ? {} : { readiness: options.readiness });
	if (options.pairingRead !== false) must(await services.cloudPairing.start());
	await seedRepo(test.container, { name: "scratch", remoteUrl: null });
	const github = await seedRepo(test.container, {
		name: "api",
		remoteUrl: "git@github.com:acme/api.git",
	});
	const create = vi
		.spyOn(actions.workspaces, "create")
		.mockImplementation(async (_input: NewWorkspaceInput) =>
			ok({ id: "w1", repoId: github.id } as unknown as Workspace),
		);
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			createRoute({
				getParentRoute: () => rootRoute,
				path: "/create",
				component: () => <CreateWorkspacePage />,
			}),
			createRoute({
				getParentRoute: () => rootRoute,
				path: "/repository/$repositoryId/workspace/$workspaceId",
				component: () => <div>Workspace opened</div>,
			}),
		]),
		history: createMemoryHistory({ initialEntries: ["/create"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return { create, github, router };
}

const createButton = () => screen.getByRole("button", { name: "Create workspace" });

describe("CLOUD-19 the new-workspace page in cloud mode", () => {
	it("with the cloud entry active the page offers the Worker's repositories and creates there", async () => {
		const { create, github, router } = await renderCloudPage();

		const picker = await screen.findByRole("button", { name: "Repository" });
		expect(picker.textContent).toContain("api");
		expect(screen.queryByRole("button", { name: /^Project:/ })).toBeNull();
		fireEvent.keyDown(picker, { key: "Enter" });
		const menu = await screen.findByRole("menu");
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
		).toEqual([expect.stringContaining("api"), expect.stringContaining("Add repository")]);
		fireEvent.keyDown(menu, { key: "Escape" });

		fireEvent.change(screen.getByLabelText("First message"), {
			target: { value: "Fix the login bug" },
		});
		await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(createButton());

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			repoId: github.id,
			prompt: "Fix the login bug",
			cloudUrl: WORKER,
		});
		await waitFor(() => expect(router.state.location.pathname).toContain("/workspace/w1"));
	});

	it("shows each readiness reason in Conductor's words, with Create off", async () => {
		const cases: [CloudReadiness, string, string][] = [
			[
				{ github: false, agents: { anthropic: true, openai: false, cursor: false } },
				"GitHub isn't connected.",
				"Connect GitHub to create a cloud workspace.",
			],
			[
				{ github: true, agents: { anthropic: false, openai: false, cursor: false } },
				"No agent set up yet.",
				"Set up an agent to create a cloud workspace.",
			],
		];
		for (const [readiness, line, reason] of cases) {
			const { create } = await renderCloudPage({ readiness });
			expect(await screen.findByText(line)).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Repository" })).toBeNull();
			expect((createButton() as HTMLButtonElement).disabled).toBe(true);
			expect(screen.getByLabelText(reason)).toBeTruthy();
			fireEvent.submit(screen.getByLabelText("First message").closest("form") as HTMLFormElement);
			expect(create).not.toHaveBeenCalled();
			cleanup();
			test?.close();
			test = null;
		}
	});

	it("says it is checking the organization until the pairing is read", async () => {
		await renderCloudPage({ pairingRead: false });
		expect(await screen.findByLabelText("Checking organization...")).toBeTruthy();
		expect((createButton() as HTMLButtonElement).disabled).toBe(true);
	});

	it("turns the cloud off while data privacy is on, with Conductor's words", async () => {
		await renderCloudPage({ dataPrivacy: true });
		expect(await screen.findByText("Cloud disabled")).toBeTruthy();
		expect(
			screen.getByLabelText(
				"Cloud workspaces are unavailable when enterprise data privacy is enabled.",
			),
		).toBeTruthy();
		expect((createButton() as HTMLButtonElement).disabled).toBe(true);
	});
});
