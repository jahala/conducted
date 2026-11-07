import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoveRepoDialog } from "./RemoveRepoDialog.tsx";

afterEach(cleanup);

describe("SET-07 RemoveRepoDialog", () => {
	it("names the workspace count and confirms once", async () => {
		const onConfirm = vi.fn().mockResolvedValue(true);
		const onOpenChange = vi.fn();
		render(
			<RemoveRepoDialog
				open
				repoName="conducted"
				workspaceCount={2}
				runningAgentCount={0}
				onOpenChange={onOpenChange}
				onConfirm={onConfirm}
			/>,
		);

		expect(screen.getByText(/2 workspaces/)).toBeTruthy();
		const dialog = screen.getByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Remove repository" }));

		await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("says one workspace without a plural", () => {
		render(
			<RemoveRepoDialog
				open
				repoName="conducted"
				workspaceCount={1}
				runningAgentCount={0}
				onOpenChange={vi.fn()}
				onConfirm={vi.fn().mockResolvedValue(true)}
			/>,
		);

		expect(screen.getByText(/1 workspace /)).toBeTruthy();
	});

	it("keeps the dialog open and shows the failure when removal fails", async () => {
		const onOpenChange = vi.fn();
		render(
			<RemoveRepoDialog
				open
				repoName="conducted"
				workspaceCount={2}
				runningAgentCount={0}
				onOpenChange={onOpenChange}
				onConfirm={vi.fn().mockResolvedValue(false)}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));

		expect(await screen.findByText("The repository could not be fully removed.")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("lists the running agents that will be stopped", () => {
		render(
			<RemoveRepoDialog
				open
				repoName="conducted"
				workspaceCount={2}
				runningAgentCount={2}
				onOpenChange={vi.fn()}
				onConfirm={vi.fn().mockResolvedValue(true)}
			/>,
		);

		expect(screen.getByText(/2 agents are running/)).toBeTruthy();
	});
});
