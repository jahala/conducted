/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: tests for the Create project dialog, the Create a private GitHub repo? dialog and the
 * Quick start button that opens them.
 * Behaviour: ui-map.md 2 and 3.9, 5.2 (the two dialogs and the landing button), services-map.md 3.9
 * (the repository-name check's messages).
 * Test first: Quick start creates the chosen folder and template through projects.createFromTemplate,
 * then asks about the private GitHub repository.
 */
import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import type { GithubAccess } from "../../core/services/github.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import {
	CreateGithubRepoDialog,
	CreateProjectDialog,
	QuickStartButton,
	QuickStartFlow,
} from "./CreateProjectDialog.tsx";

vi.mock("../../ui/Toast.tsx", () => ({
	toast: { success: vi.fn() },
	toastError: vi.fn(),
}));

const signedIn: GithubAccess = {
	status: "ok",
	login: "acme",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "ssh",
};

const created: Repo = {
	id: "repo-1" as Repo["id"],
	name: "my-app",
	rootPath: "/code/my-app",
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1000,
	updatedAt: 1000,
};

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
	test.container.services.github.store.setState((state) => ({ ...state, access: signedIn }));
});

afterEach(() => {
	cleanup();
	test.close();
});

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return (
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

function scriptOwners(): void {
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "gh") return null;
		if (command.args.join(" ") === "api user/orgs --paginate --jq .[].login") {
			return ok({ exitCode: 0, stdout: "acme\n", stderr: "" });
		}
		return null;
	});
}

function scriptNameCheck(stdout: string, exitCode: number, stderr = ""): void {
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "gh") return null;
		if (command.args.join(" ") === "repo view acme/app --json name -q .name") {
			return ok({ exitCode, stdout, stderr });
		}
		return null;
	});
}

describe("PRJ-03 Quick start", () => {
	it("opens the Create project dialog from the landing button", () => {
		render(<QuickStartButton />, { wrapper });

		fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));

		expect(screen.getByText("Create project")).toBeTruthy();
		expect(screen.getByLabelText("Project name")).toBeTruthy();
		expect(screen.getByLabelText("Parent folder")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Next.js/ })).toBeTruthy();
	});

	it("creates the project from the chosen template and then asks about GitHub", async () => {
		scriptOwners();
		scriptNameCheck("", 1, "GraphQL: Could not resolve to a Repository");
		const create = vi
			.spyOn(test.container.actions.projects, "createFromTemplate")
			.mockResolvedValue(ok(created));
		render(<QuickStartFlow open onOpenChange={() => {}} />, { wrapper });

		fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My App" } });
		fireEvent.change(screen.getByLabelText("Parent folder"), { target: { value: "/code" } });
		fireEvent.click(screen.getByRole("button", { name: /Next.js/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => expect(create).toHaveBeenCalledWith("My App", "/code", "nextjs"));
		expect(await screen.findByText("Create a private GitHub repo?")).toBeTruthy();
	});

	it("shows why a project name is not usable and keeps Create disabled", () => {
		render(<CreateProjectDialog open onOpenChange={() => {}} onCreated={() => {}} />, {
			wrapper,
		});

		fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "!!!" } });

		expect(screen.getByText("Name must include letters or numbers.")).toBeTruthy();
		expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

describe("PRJ-03 Create a private GitHub repo? dialog", () => {
	it("shows that the repository name is available and creates the repository", async () => {
		scriptOwners();
		scriptNameCheck("", 1, "GraphQL: Could not resolve to a Repository");
		const create = vi
			.spyOn(test.container.actions.projects, "createGitHubRepo")
			.mockResolvedValue(ok("https://github.com/acme/app"));
		const onCreated = vi.fn();
		render(
			<CreateGithubRepoDialog
				open
				repo={{ ...created, name: "app" }}
				onOpenChange={() => {}}
				onCreated={onCreated}
			/>,
			{ wrapper },
		);

		expect(await screen.findByText("Repository name is available.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create repository" }));

		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(created.id, {
				owner: "acme",
				name: "app",
				isPrivate: true,
			}),
		);
		await waitFor(() => expect(onCreated).toHaveBeenCalled());
	});

	it("shows that the repository already exists and does not create it", async () => {
		scriptOwners();
		scriptNameCheck("app\n", 0);
		const create = vi.spyOn(test.container.actions.projects, "createGitHubRepo");
		render(
			<CreateGithubRepoDialog
				open
				repo={{ ...created, name: "app" }}
				onOpenChange={() => {}}
				onCreated={() => {}}
			/>,
			{ wrapper },
		);

		expect(await screen.findByText("This repository already exists.")).toBeTruthy();
		expect(create).not.toHaveBeenCalled();
	});
});
