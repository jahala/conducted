import { appError, err, ok, type Result } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import type { GithubAccess } from "../../core/services/github.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { CloneGithubButton, CloneGithubDialog } from "./CloneGithubDialog.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

const signedIn: GithubAccess = {
	status: "ok",
	login: "octocat",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "ssh",
};

const repositoryRow = (name: string, owner = "octocat", isPrivate = false) => ({
	name,
	owner: { login: owner },
	description: `${name} description`,
	isPrivate,
	url: `https://github.com/${owner}/${name}`,
	sshUrl: `git@github.com:${owner}/${name}.git`,
	updatedAt: "2026-01-02T03:04:05Z",
});

const clonedRepo: Repo = {
	id: "repo-1" as Repo["id"],
	name: "alpha",
	rootPath: "/code/alpha",
	remoteUrl: "git@github.com:octocat/alpha.git",
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1000,
	updatedAt: 1000,
};

function makeTest() {
	const testContainer = createTestContainer();
	test = testContainer;
	const container = testContainer.container;
	container.services.github.store.setState((state) => ({ ...state, access: signedIn }));
	testContainer.memory.controls.scriptShell((command) => {
		if (command.program !== "gh") return null;
		const args = command.args.join(" ");
		const answer = (stdout: string): Result<{ exitCode: number; stdout: string; stderr: string }> =>
			ok({ exitCode: 0, stdout, stderr: "" });
		if (args === "api user/orgs --paginate --jq .[].login") return answer("acme\n");
		if (args === "api user/repos?per_page=8&sort=updated") {
			return answer(JSON.stringify([repositoryRow("recent-one")]));
		}
		if (args.startsWith("repo list ")) {
			return answer(
				JSON.stringify([
					repositoryRow("alpha"),
					repositoryRow("beta"),
					repositoryRow("secret", "octocat", true),
				]),
			);
		}
		return null;
	});
	const renderDialog = (
		options: {
			open?: boolean;
			onOpenChange?: (open: boolean) => void;
			onCloned?: (repo: Repo) => void;
		} = {},
	) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		return render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={container}>
					<CloneGithubDialog
						open={options.open ?? true}
						onOpenChange={options.onOpenChange ?? (() => {})}
						onCloned={options.onCloned ?? (() => {})}
					/>
				</ServicesProvider>
			</QueryClientProvider>,
		);
	};
	return { container, renderDialog };
}

describe("PRJ-02 Clone GitHub repo dialog", () => {
	it("suggests a folder when it opens, as Conductor does, so Clone needs only a repository", async () => {
		const { renderDialog } = makeTest();
		renderDialog();

		await waitFor(() =>
			expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe(
				"/Users/conducted/conducted/repos",
			),
		);
	});

	it("lists the owner's repositories and fills the URL when one is chosen", async () => {
		const { renderDialog } = makeTest();
		renderDialog();

		const list = await screen.findByRole("list", { name: "Repositories" });
		const alpha = await within(list).findByRole("button", { name: /octocat\/alpha/ });
		fireEvent.click(alpha);

		const url = screen.getByLabelText("Repository URL") as HTMLInputElement;
		expect(url.value).toBe("git@github.com:octocat/alpha.git");
	});

	it("lists the account and its organisations in the owner picker", async () => {
		const { renderDialog } = makeTest();
		renderDialog();

		const owner = await screen.findByRole("combobox", { name: "Account" });
		fireEvent.keyDown(owner, { key: "Enter" });
		expect(await screen.findByRole("option", { name: "acme (organisation)" })).toBeTruthy();
	});

	it("fills the location with the folder the user picks", async () => {
		const { container, renderDialog } = makeTest();
		container.platform.dialogs.pickFolder = async () => "/code";
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Browse" }));

		await waitFor(() =>
			expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("/code"),
		);
	});

	it("titles the folder picker as Conductor does", async () => {
		const { container, renderDialog } = makeTest();
		const pick = vi.fn(async () => "/code");
		container.platform.dialogs.pickFolder = pick;
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Browse" }));

		await waitFor(() =>
			expect(pick).toHaveBeenCalledWith(
				expect.objectContaining({ title: "Choose where to clone the repository" }),
			),
		);
	});

	it("describes itself in Conductor's words, for screen readers only", async () => {
		const { renderDialog } = makeTest();
		renderDialog();

		const dialog = await screen.findByRole("dialog");
		expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
		const description = screen.getByText("Choose a recent repo or paste a clone URL.");
		expect(description.closest("[style]")?.getAttribute("style")).toContain("clip");
		expect(
			screen.queryByText("Clone a repository from GitHub and add it as a project."),
		).toBeNull();
	});

	it("reads Cloning... on its button and above the clone's progress while git runs", async () => {
		const { renderDialog } = makeTest();
		let finish: (result: Result<{ exitCode: number; stdout: string; stderr: string }>) => void =
			() => {};
		test?.memory.controls.scriptShell((command) =>
			command.program === "gh" && command.args[0] === "repo" && command.args[1] === "clone"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: null,
		);
		renderDialog();

		fireEvent.change(screen.getByLabelText("Repository URL"), {
			target: { value: "git@github.com:octocat/alpha.git" },
		});
		fireEvent.change(screen.getByLabelText("Location"), { target: { value: "/code" } });
		fireEvent.click(screen.getByRole("button", { name: "Clone repository" }));

		expect(await screen.findByRole("button", { name: "Cloning..." })).toBeTruthy();
		expect(screen.getByText("Cloning...", { selector: "p" })).toBeTruthy();
		finish(err(appError("git_failed", "stopped by the test")));
		await waitFor(() => expect(screen.queryByRole("button", { name: "Cloning..." })).toBeNull());
	});

	it("clones the repository into the chosen location", async () => {
		const { container, renderDialog } = makeTest();
		const clone = vi.spyOn(container.actions.projects, "clone").mockResolvedValue(ok(clonedRepo));
		const onCloned = vi.fn();
		renderDialog({ onCloned });

		fireEvent.change(screen.getByLabelText("Repository URL"), {
			target: { value: "git@github.com:octocat/alpha.git" },
		});
		fireEvent.change(screen.getByLabelText("Location"), { target: { value: "/code" } });
		fireEvent.click(screen.getByRole("button", { name: "Clone repository" }));

		await waitFor(() =>
			expect(clone).toHaveBeenCalledWith("git@github.com:octocat/alpha.git", "/code"),
		);
		// The place that opened the dialog gets the clone, to open it (useOpenAddedProject).
		await waitFor(() => expect(onCloned).toHaveBeenCalledWith(clonedRepo));
	});

	it("shows why a clone failed and keeps the dialog open", async () => {
		const { container, renderDialog } = makeTest();
		vi.spyOn(container.actions.projects, "clone").mockResolvedValue(
			err(appError("git_failed", "fatal: repository not found")),
		);
		container.services.repo.store.setState((state) => ({
			...state,
			cloneProgress: {
				state: "failed",
				url: "git@github.com:octocat/alpha.git",
				destination: "/code/alpha",
				output: "fatal: repository not found",
			},
		}));
		renderDialog();

		expect(await screen.findByText("fatal: repository not found")).toBeTruthy();
	});

	it("opens from the landing button", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={testContainer.container}>
					<CloneGithubButton />
				</ServicesProvider>
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open GitHub project" }));

		expect(await screen.findByRole("dialog")).toBeTruthy();
	});
});
