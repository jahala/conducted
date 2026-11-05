/**
 * @feature NAV-08 Command palette
 * Owns: tests that open the palette through the real app root and exercise its workspaces, tabs, shortcuts and
 * empty state.
 * Behaviour: ui-map.md 5.1 (tabs and placeholders, workspace actions), 5.4 (Cmd+K).
 * Test first: typing "arch" lists "Archive workspace" when a workspace is open and not when none is.
 */
import { ok } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo, Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const containers: { close(): void }[] = [];

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	vi.restoreAllMocks();
	for (const container of containers.splice(0)) container.close();
});

interface Mounted {
	container: Container;
	workspace: Workspace | null;
	repo: Repo;
	router: ReturnType<typeof createAppRouter>;
}

async function mountApp(
	withWorkspace: boolean,
	before: (container: Container) => void = () => {},
): Promise<Mounted> {
	const test = createTestContainer();
	containers.push(test);
	before(test.container);
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container, { name: "conducted" });
	const workspace = withWorkspace
		? await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: "fix-login",
			})
		: null;
	const path =
		workspace === null ? "/" : `/repository/${workspace.repoId}/workspace/${workspace.id}`;
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	useOverlayStore.getState().show("palette");
	return { container: test.container, workspace, repo, router };
}

async function openPalette(
	withWorkspace: boolean,
	before: (container: Container) => void = () => {},
) {
	const mounted = await mountApp(withWorkspace, before);
	const input = await screen.findByPlaceholderText("Type a command or search...");
	return { ...mounted, input };
}

async function mountBare() {
	const test = createTestContainer();
	containers.push(test);
	await test.container.services.settings.start();
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	useOverlayStore.getState().show("palette");
	return test.container;
}

describe("NAV-08 CommandPalette", () => {
	it("lists Archive workspace for a matching query when a workspace is open", async () => {
		const { input } = await openPalette(true);
		fireEvent.change(input, { target: { value: "arch" } });
		expect(await screen.findByText("Archive workspace")).toBeTruthy();
	});

	it("hides workspace actions when no workspace is open", async () => {
		const { input } = await openPalette(false);
		fireEvent.change(input, { target: { value: "arch" } });
		expect(await screen.findByText("View archived workspaces")).toBeTruthy();
		expect(screen.queryByText("Archive workspace")).toBeNull();
	});

	it("changes the placeholder with the tab and cycles tabs with Tab and Shift+Tab", async () => {
		const { input } = await openPalette(false);
		fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
		expect(input.getAttribute("placeholder")).toBe("Search workspaces...");

		fireEvent.keyDown(input, { key: "Tab" });
		expect(input.getAttribute("placeholder")).toBe("Search projects...");

		fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
		expect(input.getAttribute("placeholder")).toBe("Search workspaces...");
	});

	it("lists settings pages on the settings tab", async () => {
		await openPalette(false);
		fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
		expect(await screen.findByText("General")).toBeTruthy();
		expect(screen.getByText("Claude Code")).toBeTruthy();
	});

	it("shows the loading spinner before the stores have loaded", async () => {
		await mountBare();
		expect(await screen.findByRole("status", { name: "Loading the command palette" })).toBeTruthy();
	});

	it("shows No results found for a query with no matches", async () => {
		const { input } = await openPalette(false);
		fireEvent.change(input, { target: { value: "zzzzzz" } });
		expect(await screen.findByText("No results found")).toBeTruthy();
	});

	it("opens the new-workspace page for the chosen project", async () => {
		const { repo, router } = await openPalette(false);
		fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
		fireEvent.click(await screen.findByText("conducted"));

		await waitFor(() => expect(router.state.location.pathname).toBe("/create"));
		expect(router.state.location.search).toEqual({ repo: repo.id });
	});

	it("runs a chosen action and closes", async () => {
		const { container, input } = await openPalette(false);
		const check = vi.spyOn(container.services.updates, "check").mockResolvedValue(ok(undefined));
		fireEvent.change(input, { target: { value: "check for updates" } });
		fireEvent.click(await screen.findByText("Check for updates"));

		await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(screen.queryByPlaceholderText("Type a command or search...")).toBeNull(),
		);
	});

	it("says so when the apps to open a workspace in cannot be listed", async () => {
		await openPalette(true, (container) => {
			vi.spyOn(container.platform.opener, "installedApps").mockRejectedValue(
				new Error("Launch Services did not answer."),
			);
		});

		expect(
			await screen.findByText(
				"Couldn't list the apps to open the workspace in. Launch Services did not answer.",
			),
		).toBeTruthy();
	});

	async function openSectionsPage() {
		const mounted = await openPalette(true);
		const created = await mounted.container.actions.sections.create("Ideas", null);
		if (!created.ok) throw new Error(created.error.message);
		fireEvent.change(mounted.input, { target: { value: "move to section" } });
		fireEvent.click(await screen.findByText("Move to section"));
		const sections = await screen.findByPlaceholderText("Search sections...");
		// The sidebar lists the section too, so look for its row inside the palette only.
		const palette = within(screen.getByRole("dialog", { name: "Command palette" }));
		const row = await palette.findByText("Ideas");
		fireEvent.pointerMove(row);
		return { ...mounted, section: created.value, sections, palette };
	}

	it("opens the section sub-page from Move to section", async () => {
		const { sections, palette } = await openSectionsPage();
		expect(sections).toBeTruthy();
		expect(palette.getByText("Ideas")).toBeTruthy();
	});

	it("edits the highlighted section with Cmd+E pressed into the root dispatcher", async () => {
		const { sections } = await openSectionsPage();
		fireEvent.keyDown(sections, { key: "e", metaKey: true });

		const field = (await screen.findByLabelText("Section name")) as HTMLInputElement;
		expect(field.value).toBe("Ideas");
	});

	it("deletes the highlighted section with Cmd+Backspace pressed into the root dispatcher", async () => {
		const { container, section, sections } = await openSectionsPage();
		fireEvent.keyDown(sections, { key: "Backspace", metaKey: true });

		await waitFor(() =>
			expect(
				container.services.sections.store
					.getState()
					.sections.some((entry: { id: string }) => entry.id === section.id),
			).toBe(false),
		);
	});
});
