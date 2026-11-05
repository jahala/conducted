import { appError, err, ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	addLocal: vi.fn(),
	pick: vi.fn(),
	toastError: vi.fn(),
	repos: { state: "ready", data: [] } as Loadable<Repo[]>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ projects: { addLocal: state.addLocal }, app: { pickFolder: state.pick } }),
	useRepos: () => state.repos,
}));
vi.mock("../../ui/Toast.tsx", () => ({ toastError: state.toastError }));

const { AddProjectButton, recentProjects } = await import("./AddProjectButton.tsx");

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

	it("adds the folder the user picked", async () => {
		state.pick.mockResolvedValue(ok("/code/app"));
		state.addLocal.mockResolvedValue(ok({}));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() => expect(state.addLocal).toHaveBeenCalledWith("/code/app"));
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
	it("lists the most recently updated projects first", () => {
		const older = repo("repo-1", "older", 10);
		const newer = repo("repo-2", "newer", 20);
		expect(recentProjects([older, newer], 1)).toEqual([newer]);
		expect(recentProjects([older, newer])).toEqual([newer, older]);
	});

	it("opens the folder dialog from Open project in the menu", async () => {
		state.repos = { state: "ready", data: [repo("repo-1", "app", 10)] };
		state.pick.mockResolvedValue(ok("/code/other"));
		state.addLocal.mockResolvedValue(ok({}));
		render(<AddProjectButton />);
		fireEvent.keyDown(screen.getByRole("button", { name: /Add a project/ }), { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Open project..." }));
		await waitFor(() => expect(state.addLocal).toHaveBeenCalledWith("/code/other"));
	});

	it("opens a recent project folder from the Recents group", async () => {
		const app = repo("repo-1", "app", 10);
		const site = repo("repo-2", "site", 20);
		state.repos = { state: "ready", data: [app, site] };
		state.addLocal.mockResolvedValue(ok({}));
		render(<AddProjectButton />);
		fireEvent.keyDown(screen.getByRole("button", { name: /Add a project/ }), { key: "Enter" });
		expect(await screen.findByText("Recents")).toBeTruthy();
		fireEvent.click(await screen.findByRole("menuitem", { name: "site" }));
		await waitFor(() => expect(state.addLocal).toHaveBeenCalledWith("/code/site"));
		expect(state.pick).not.toHaveBeenCalled();
	});
});
