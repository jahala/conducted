import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { ProjectStep } from "./ProjectStep.tsx";

afterEach(cleanup);

const project = (path: string): Repo => ({
	id: "repo-1" as Repo["id"],
	name: "my-app",
	rootPath: path,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 0,
	updatedAt: 0,
});

function setup() {
	const test = createTestContainer();
	const onFinish = vi.fn();
	render(
		<ServicesProvider container={test.container}>
			<ProjectStep onFinish={onFinish} />
		</ServicesProvider>,
	);
	return { test, onFinish };
}

function close(test: TestContainer) {
	test.close();
}

describe("APP-02 onboarding project step", () => {
	it("adds the picked folder and then finishes onboarding", async () => {
		const { test, onFinish } = setup();
		const addLocal = vi
			.spyOn(test.container.services.repo, "addLocal")
			.mockResolvedValue(ok(project("/code/my-app")));
		test.memory.controls.queueDialogAnswers({ folder: "/code/my-app" });
		try {
			fireEvent.click(screen.getByRole("button", { name: "Add a project" }));
			await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
			expect(addLocal).toHaveBeenCalledWith("/code/my-app");
		} finally {
			close(test);
		}
	});

	it("does nothing when the folder dialog is cancelled", async () => {
		const { test, onFinish } = setup();
		const addLocal = vi.spyOn(test.container.services.repo, "addLocal");
		test.memory.controls.queueDialogAnswers({ folder: null });
		try {
			fireEvent.click(screen.getByRole("button", { name: "Add a project" }));
			await waitFor(() => expect(addLocal).not.toHaveBeenCalled());
			expect(onFinish).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
		} finally {
			close(test);
		}
	});

	it("keeps the action's message on the step when the folder is not a repository", async () => {
		const { test, onFinish } = setup();
		vi.spyOn(test.container.services.repo, "addLocal").mockResolvedValue(
			err(appError("not_git", "That folder is not a Git repository.")),
		);
		test.memory.controls.queueDialogAnswers({ folder: "/code/notes" });
		try {
			fireEvent.click(screen.getByRole("button", { name: "Add a project" }));
			expect(await screen.findByText("That folder is not a Git repository.")).toBeTruthy();
			expect(onFinish).not.toHaveBeenCalled();
		} finally {
			close(test);
		}
	});

	it("can be skipped", () => {
		const { test, onFinish } = setup();
		try {
			fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
			expect(onFinish).toHaveBeenCalledTimes(1);
		} finally {
			close(test);
		}
	});
});
