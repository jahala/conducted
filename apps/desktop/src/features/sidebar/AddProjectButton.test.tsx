import { appError, err, ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	addLocal: vi.fn(),
	createFirst: vi.fn(),
	navigate: vi.fn(),
	pick: vi.fn(),
	toastError: vi.fn(),
	repos: { state: "ready", data: [] } as Loadable<Repo[]>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		projects: { addLocal: state.addLocal },
		workspaces: { createFirst: state.createFirst },
		app: { pickFolder: state.pick },
	}),
	useGitHubOwners: () => ({ state: "loading" }),
	useRepoNameCheck: () => ({ state: "loading" }),
	useRepos: () => state.repos,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../../ui/Toast.tsx", () => ({
	toast: { success: vi.fn() },
	toastError: state.toastError,
}));

const { AddProjectButton, AddProjectMenu } = await import("./AddProjectButton.tsx");
const { CommandRegistryProvider, createCommandRegistry } = await import(
	"../../app/command-dispatcher.ts"
);

const repo = (id: string, name: string, updatedAt: number): Repo => ({
	id: id as Repo["id"],
	name,
	rootPath: `/code/${name}`,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt,
});

beforeEach(() => {
	state.addLocal.mockReset();
	state.createFirst.mockReset();
	state.navigate.mockReset();
	state.pick.mockReset();
	state.toastError.mockReset();
	state.repos = { state: "ready", data: [] };
});
afterEach(cleanup);

describe("PRJ-01 AddProjectButton", () => {
	it("is the landing screen's Open project button", () => {
		render(<AddProjectButton variant="default" size="lg" />);
		expect(screen.getByRole("button", { name: /Open project/ })).toBeTruthy();
	});

	it("adds the folder the user picked, then opens a new workspace in it", async () => {
		state.pick.mockResolvedValue(ok("/code/app"));
		state.addLocal.mockResolvedValue(ok(repo("r1", "app", 1)));
		state.createFirst.mockResolvedValue(ok({ id: "w1" }));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() => expect(state.addLocal).toHaveBeenCalledWith("/code/app"));
		await waitFor(() =>
			expect(state.navigate).toHaveBeenCalledWith({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: { repositoryId: "r1", workspaceId: "w1" },
			}),
		);
		expect(state.createFirst).toHaveBeenCalledWith("r1");
		expect(state.toastError).not.toHaveBeenCalled();
	});

	it("does nothing when the folder dialog is cancelled", async () => {
		state.pick.mockResolvedValue(ok(null));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() => expect(state.pick).toHaveBeenCalled());
		expect(state.addLocal).not.toHaveBeenCalled();
	});

	it("tells the user when the folder dialog fails", async () => {
		const failure = appError("dialog_failed", "The dialog did not open");
		state.pick.mockResolvedValue(err(failure));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't open the folder dialog", failure),
		);
		expect(state.addLocal).not.toHaveBeenCalled();
	});

	it("tells the user why adding failed", async () => {
		const failure = appError("not_git", "That folder is not a git repository");
		state.pick.mockResolvedValue(ok("/code/notes"));
		state.addLocal.mockResolvedValue(err(failure));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't add the project", failure),
		);
	});

	it("ignores a second click while one add is running", async () => {
		let release: (value: Result<string | null>) => void = () => {};
		state.pick.mockReturnValue(
			new Promise<Result<string | null>>((resolve) => (release = resolve)),
		);
		render(<AddProjectButton />);
		const button = screen.getByRole("button", { name: /Add a project/ });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(state.pick).toHaveBeenCalledTimes(1);
		release(ok(null));
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
	});
});

describe("PRJ-01 Add project menu", () => {
	it("opens the folder dialog from Open project in the menu", async () => {
		state.repos = { state: "ready", data: [repo("repo-1", "app", 10)] };
		state.pick.mockResolvedValue(ok("/code/other"));
		state.addLocal.mockResolvedValue(ok(repo("repo-2", "other", 1)));
		state.createFirst.mockResolvedValue(ok({ id: "w2" }));
		render(<AddProjectButton />);
		fireEvent.keyDown(screen.getByRole("button", { name: /Add a project/ }), { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Open project" }));
		await waitFor(() => expect(state.addLocal).toHaveBeenCalledWith("/code/other"));
	});

	// Conductor's add-project menu lists Recents: folders opened before that are not projects yet
	// (renderApp @10174083). We keep no such list, so the group is left out.
	it("has no Recents group, since no list of recent non-project folders is kept", async () => {
		state.repos = { state: "ready", data: [repo("repo-1", "app", 10)] };
		render(<AddProjectButton />);
		fireEvent.keyDown(screen.getByRole("button", { name: /Add a project/ }), { key: "Enter" });
		expect(await screen.findByRole("menuitem", { name: "Open project" })).toBeTruthy();
		expect(screen.queryByText("Recents")).toBeNull();
	});
});

describe("PRJ-01 sidebar add-project menu", () => {
	it("opens Conductor's three items when the Add project command runs", async () => {
		state.repos = { state: "ready", data: [repo("repo-1", "app", 10)] };
		const registry = createCommandRegistry();
		render(
			<CommandRegistryProvider registry={registry}>
				<AddProjectMenu />
			</CommandRegistryProvider>,
		);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(registry.run("project.add")).toBe(true);
		const menu = await screen.findByRole("menu", { name: "Add project" });
		const items = Array.from(menu.querySelectorAll("[role=menuitem]")).map(
			(item) => item.textContent,
		);
		expect(items).toEqual(["Open project", "Open GitHub project", "Quick start"]);
	});
});
