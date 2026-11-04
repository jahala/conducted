import { appError, err, ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	addLocal: vi.fn(),
	pick: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ projects: { addLocal: state.addLocal }, app: { pickFolder: state.pick } }),
}));
vi.mock("../../ui/Toast.tsx", () => ({ toast: { error: state.toastError } }));

const { AddProjectButton } = await import("./AddProjectButton.tsx");

beforeEach(() => {
	state.addLocal.mockReset();
	state.pick.mockReset();
	state.toastError.mockReset();
});
afterEach(cleanup);

describe("AddProjectButton", () => {
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
		state.pick.mockResolvedValue(err(appError("dialog_failed", "The dialog did not open")));
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't open the folder dialog", {
				description: "The dialog did not open",
			}),
		);
		expect(state.addLocal).not.toHaveBeenCalled();
	});

	it("tells the user why adding failed", async () => {
		state.pick.mockResolvedValue(ok("/code/notes"));
		state.addLocal.mockResolvedValue(
			err(appError("not_git", "That folder is not a git repository")),
		);
		render(<AddProjectButton />);
		fireEvent.click(screen.getByRole("button", { name: /Add a project/ }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't add the project", {
				description: "That folder is not a git repository",
			}),
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
