/**
 * @feature NAV-17 Deep-link routes: settings, browser tab, create with a prompt
 * Owns: tests for the URL parser, the route opener and the route the real app reaches from the
 * Platform's deep-link event.
 * Behaviour: native-and-sidecar-map.md A8; services-map.md 5B.2.5.
 * Test first: "conducted://settings-enable?key=experimental_big_terminal_mode" gives kind "enable-setting" with
 * that key, and "https://example.com" is an error.
 */
import { ok, type RepoId, type SessionId, type WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { getSettingDef } from "../core/registries/settings.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { toast } from "../ui/Toast.tsx";
import { type DeepLinkDeps, openDeepLink, parseDeepLinkRoute } from "./deep-link-routes.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("NAV-17 parseDeepLinkRoute", () => {
	it("turns a settings-enable link into the key it names", () => {
		const route = parseDeepLinkRoute(
			"conducted://settings-enable?key=experimental_big_terminal_mode",
		);
		expect(route).toEqual({
			ok: true,
			value: { kind: "enable-setting", key: "experimental_big_terminal_mode" },
		});
	});

	it("refuses a setting that is not experimental", () => {
		const route = parseDeepLinkRoute("conducted://settings-enable?key=theme");
		expect(route.ok).toBe(false);
		if (route.ok) throw new Error("the link should be refused");
		expect(route.error.code).toBe("deep_link_setting_not_allowed");
	});

	it("opens a user settings page", () => {
		expect(parseDeepLinkRoute("conducted://settings/experimental")).toEqual({
			ok: true,
			value: { kind: "open-settings", target: { kind: "user", page: "experimental" } },
		});
	});

	it("opens a repository settings page", () => {
		expect(parseDeepLinkRoute("conducted://settings/repos/r1/scripts")).toEqual({
			ok: true,
			value: {
				kind: "open-settings",
				target: { kind: "repo", repoId: "r1" as RepoId, page: "scripts" },
			},
		});
	});

	it("refuses a settings page that does not exist", () => {
		const route = parseDeepLinkRoute("conducted://settings/nope");
		expect(route.ok).toBe(false);
	});

	it("opens a workspace and its chat", () => {
		expect(parseDeepLinkRoute("conducted://workspace?id=w1&session=s1")).toEqual({
			ok: true,
			value: {
				kind: "open-workspace",
				workspaceId: "w1" as WorkspaceId,
				sessionId: "s1" as SessionId,
			},
		});
	});

	it("opens a workspace without a chat", () => {
		expect(parseDeepLinkRoute("conducted://workspace?id=w1")).toEqual({
			ok: true,
			value: { kind: "open-workspace", workspaceId: "w1" as WorkspaceId, sessionId: null },
		});
	});

	it("refuses a workspace link with no id", () => {
		const route = parseDeepLinkRoute("conducted://workspace");
		expect(route.ok).toBe(false);
	});

	it("opens a browser link with its workspace, and reads no navigate flag nothing would use", () => {
		expect(
			parseDeepLinkRoute(
				"conducted://browser?url=https%3A%2F%2Fexample.com%2Fpath&workspace-id=w1&navigate=true",
			),
		).toEqual({
			ok: true,
			value: {
				kind: "open-browser",
				url: "https://example.com/path",
				workspaceId: "w1" as WorkspaceId,
			},
		});
	});

	it("refuses a browser URL that is not http or https", () => {
		const route = parseDeepLinkRoute(
			"conducted://browser?url=file%3A%2F%2F%2Fetc%2Fpasswd&workspace-id=w1",
		);
		expect(route.ok).toBe(false);
		if (route.ok) throw new Error("the link should be refused");
		expect(route.error.code).toBe("deep_link_browser_url_invalid");
	});

	it("decodes a base64 plan", () => {
		const plan = btoa("Fix the parser");
		expect(parseDeepLinkRoute(`conducted://async?repo=Project&plan=${plan}`)).toEqual({
			ok: true,
			value: { kind: "create-from-plan", repoName: "Project", plan: "Fix the parser" },
		});
	});

	it("refuses plan data that is not base64 and an empty plan", () => {
		const invalid = parseDeepLinkRoute("conducted://async?repo=Project&plan=not%20base64!");
		expect(invalid.ok).toBe(false);
		if (invalid.ok) throw new Error("the link should be refused");
		expect(invalid.error.code).toBe("deep_link_plan_invalid");

		const empty = parseDeepLinkRoute(`conducted://async?repo=Project&plan=${btoa("   ")}`);
		expect(empty.ok).toBe(false);
		if (empty.ok) throw new Error("the link should be refused");
		expect(empty.error.code).toBe("deep_link_plan_empty");
	});

	it("reads a create-with-prompt link with a path, branch and prompt", () => {
		expect(
			parseDeepLinkRoute(
				"conducted://?path=%2Fcode%2Fproject&branch=feature%2Ffix&prompt=Fix%20the%20login",
			),
		).toEqual({
			ok: true,
			value: {
				kind: "create-with-prompt",
				path: "/code/project",
				branch: "feature/fix",
				prompt: "Fix the login",
			},
		});
	});

	it("reads the older create-with-prompt shape whose values form the host", () => {
		expect(
			parseDeepLinkRoute("conducted://path=%2Fcode%2Fproject&prompt=Fix%20the%20login"),
		).toEqual({
			ok: true,
			value: {
				kind: "create-with-prompt",
				path: "/code/project",
				branch: null,
				prompt: "Fix the login",
			},
		});
	});

	it("reports every host left out on purpose as unsupported, with its query ignored", () => {
		for (const url of [
			"conducted://auth?code=x&prompt=hi",
			"conducted://gh-auth?token=t",
			"conducted://automation?organizationId=o&id=1",
			"conducted://loadout?d=abc",
			"conducted://cloud-collab-onboarding",
			"conducted://join-organization-onboarding",
			"conducted://github-connected?organizationId=o&status=ok",
			"conducted://__onboarding_add_repository",
			"conducted://dev/workspaces",
			"conducted://session/w1",
		]) {
			const route = parseDeepLinkRoute(url);
			expect(route.ok, url).toBe(false);
			if (route.ok) throw new Error(`${url} should be unsupported`);
			expect(route.error.code, url).toBe("deep_link_unsupported");
		}
	});

	it("refuses a host that is neither a route nor key=value text", () => {
		const route = parseDeepLinkRoute("conducted://somewhere?prompt=hi");
		expect(route.ok).toBe(false);
		if (route.ok) throw new Error("the link should be refused");
		expect(route.error.code).toBe("deep_link_invalid");
	});

	it("refuses another scheme and a string that is not a URL", () => {
		expect(parseDeepLinkRoute("https://example.com").ok).toBe(false);
		expect(parseDeepLinkRoute("not a url").ok).toBe(false);
	});
});

function openerHarness(test: TestContainer) {
	const navigate = {
		workspace: vi.fn(),
		settings: vi.fn(),
		browser: vi.fn(),
		create: vi.fn(),
	};
	const notify = {
		error: vi.fn(),
		enabledSetting: vi.fn(),
		log: vi.fn(),
	};
	const createFromPlan = vi.fn(async (_repositoryId: RepoId, _plan: string) => ({
		ok: true as const,
		value: undefined,
	}));
	const repos = () => Object.values(test.container.services.repo.store.getState().reposById);
	const deps: DeepLinkDeps = {
		workspaceRepoId: (workspaceId) =>
			test.container.services.workspace.store.getState().workspacesById[workspaceId]?.repoId,
		repoByName: (name) => repos().find((repo) => repo.name === name)?.id,
		repoByPath: (path) => repos().find((repo) => repo.rootPath === path)?.id,
		setSetting: (key, value) => test.container.services.settings.set(key, value),
		createFromPlan,
		navigate,
		notify,
	};
	return { deps, navigate, notify, createFromPlan };
}

async function seededTest() {
	const test = createTestContainer();
	const repo = await seedRepo(test.container, { name: "Project", rootPath: "/code/project" });
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	return { test, repo, workspace };
}

describe("NAV-17 openDeepLink", () => {
	it("opens a workspace in the repository that owns it", async () => {
		const { test, repo, workspace } = await seededTest();
		try {
			const { deps, navigate } = openerHarness(test);
			await openDeepLink(`conducted://workspace?id=${workspace.id}&session=s1`, deps);
			expect(navigate.workspace).toHaveBeenCalledWith(workspace.id, repo.id, "s1");
		} finally {
			test.close();
		}
	});

	it("opens the settings page the link names", async () => {
		const { test } = await seededTest();
		try {
			const { deps, navigate } = openerHarness(test);
			await openDeepLink("conducted://settings/repos/r1/scripts", deps);
			expect(navigate.settings).toHaveBeenCalledWith({
				kind: "repo",
				repoId: "r1",
				page: "scripts",
			});
		} finally {
			test.close();
		}
	});

	it("enables an experimental setting and offers the page that holds it", async () => {
		const { test } = await seededTest();
		try {
			const { deps, navigate, notify } = openerHarness(test);
			await openDeepLink("conducted://settings-enable?key=experimental_big_terminal_mode", deps);

			expect(test.container.services.settings.get<boolean>("experimental_big_terminal_mode")).toBe(
				true,
			);
			const title = getSettingDef("experimental_big_terminal_mode")?.title;
			expect(title).toBe("Big terminal mode");
			expect(notify.enabledSetting).toHaveBeenCalledWith(
				"experimental_big_terminal_mode",
				"Big terminal mode",
				expect.any(Function),
			);

			const goToSetting = notify.enabledSetting.mock.calls[0]?.[2] as () => void;
			goToSetting();
			expect(navigate.settings).toHaveBeenCalledWith({ kind: "user", page: "experimental" });
		} finally {
			test.close();
		}
	});

	it("refuses to enable a setting that is not experimental", async () => {
		const { test } = await seededTest();
		try {
			const { deps, notify } = openerHarness(test);
			await openDeepLink("conducted://settings-enable?key=theme", deps);

			expect(notify.error).toHaveBeenCalledWith(
				"Setting cannot be enabled by link",
				expect.objectContaining({ code: "deep_link_setting_not_allowed" }),
			);
		} finally {
			test.close();
		}
	});

	it("opens a browser tab in the workspace the link names", async () => {
		const { test, repo, workspace } = await seededTest();
		try {
			const { deps, navigate } = openerHarness(test);
			await openDeepLink(
				`conducted://browser?url=https%3A%2F%2Fexample.com&workspace-id=${workspace.id}&navigate=true`,
				deps,
			);
			expect(navigate.browser).toHaveBeenCalledWith(workspace.id, repo.id, "https://example.com");
		} finally {
			test.close();
		}
	});

	it("starts a workspace from a decoded plan and its project", async () => {
		const { test, repo } = await seededTest();
		try {
			const { deps, createFromPlan } = openerHarness(test);
			await openDeepLink(`conducted://async?repo=Project&plan=${btoa("Fix the parser")}`, deps);
			expect(createFromPlan).toHaveBeenCalledWith(repo.id, "Fix the parser");
		} finally {
			test.close();
		}
	});

	it("starts nothing when the plan names a repository that is not loaded", async () => {
		const { test } = await seededTest();
		try {
			const { deps, createFromPlan, notify } = openerHarness(test);
			await openDeepLink(`conducted://async?repo=Elsewhere&plan=${btoa("Fix the parser")}`, deps);
			expect(createFromPlan).not.toHaveBeenCalled();
			expect(notify.error).toHaveBeenCalledWith(
				"Repository not found",
				expect.objectContaining({ code: "deep_link_repo_not_found" }),
			);
		} finally {
			test.close();
		}
	});

	it("says so when a create link's path is no project, and chooses no project from it", async () => {
		const { test } = await seededTest();
		try {
			const { deps, navigate, notify } = openerHarness(test);
			await openDeepLink("conducted://?path=%2Fcode%2Felsewhere&prompt=Fix%20the%20login", deps);
			expect(notify.error).toHaveBeenCalledWith(
				"Repository not found",
				expect.objectContaining({ code: "deep_link_repo_not_found" }),
			);
			expect(navigate.create).toHaveBeenCalledWith({ prompt: "Fix the login" });
		} finally {
			test.close();
		}
	});

	it("prefills the create page from a path, branch and prompt", async () => {
		const { test, repo } = await seededTest();
		try {
			const { deps, navigate } = openerHarness(test);
			await openDeepLink(
				"conducted://?path=%2Fcode%2Fproject&branch=feature%2Ffix&prompt=Fix%20the%20login",
				deps,
			);
			expect(navigate.create).toHaveBeenCalledWith({
				repo: repo.id,
				branch: "feature/fix",
				prompt: "Fix the login",
			});
		} finally {
			test.close();
		}
	});

	it("reports another scheme instead of opening anything", async () => {
		const { test } = await seededTest();
		try {
			const { deps, navigate, notify } = openerHarness(test);
			await openDeepLink("https://example.com", deps);
			expect(navigate.workspace).not.toHaveBeenCalled();
			expect(notify.error).toHaveBeenCalledWith(
				"Invalid deep link",
				expect.objectContaining({ code: "deep_link_scheme" }),
			);
		} finally {
			test.close();
		}
	});
});

/** Mounts the app's router over the container, after the settings load as the app's start does. */
async function renderApp(test: TestContainer, path = "/all-workspaces") {
	const settings = await test.container.services.settings.start();
	if (!settings.ok) throw new Error(JSON.stringify(settings.error));
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

describe("NAV-17 the app reaches deep links through its Platform event", () => {
	it("opens a settings page from a deep-link event", async () => {
		const { test } = await seededTest();
		try {
			const router = await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink("conducted://settings/experimental");
			});

			await waitFor(() => expect(router.state.location.pathname).toBe("/settings/experimental"));
		} finally {
			test.close();
		}
	});

	it("enables a setting and shows the notice with Go to setting", async () => {
		const { test } = await seededTest();
		try {
			await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink(
					"conducted://settings-enable?key=experimental_big_terminal_mode",
				);
			});

			expect(await screen.findByText("Enabled setting: Big terminal mode")).toBeTruthy();
			expect(test.container.services.settings.get<boolean>("experimental_big_terminal_mode")).toBe(
				true,
			);
			expect(screen.getByRole("button", { name: "Go to setting" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("starts a workspace from a decoded plan through the app", async () => {
		const { test, repo, workspace } = await seededTest();
		try {
			const create = vi
				.spyOn(test.container.actions.workspaces, "create")
				.mockResolvedValue(ok(workspace));
			await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink(
					`conducted://async?repo=Project&plan=${btoa("Fix the parser")}`,
				);
			});

			await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
			expect(create.mock.calls[0]?.[0]).toMatchObject({
				repoId: repo.id,
				prompt: "Fix the parser",
				from: { kind: "default" },
			});
		} finally {
			test.close();
		}
	});

	it("opens a browser tab at the link's URL in the workspace route", async () => {
		const { test, repo, workspace } = await seededTest();
		try {
			const router = await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink(
					`conducted://browser?url=https%3A%2F%2Fexample.com%2Fdocs&workspace-id=${workspace.id}&navigate=true`,
				);
			});

			await waitFor(() =>
				expect(router.state.location.pathname).toBe(
					`/repository/${repo.id}/workspace/${workspace.id}`,
				),
			);
			expect(router.state.location.search).toEqual({
				tab: "browser",
				browserUrl: "https://example.com/docs",
			});
		} finally {
			test.close();
		}
	});

	it("starts no workspace when the plan's repository is not loaded", async () => {
		const { test, workspace } = await seededTest();
		try {
			const create = vi
				.spyOn(test.container.actions.workspaces, "create")
				.mockResolvedValue(ok(workspace));
			await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink(
					`conducted://async?repo=Elsewhere&plan=${btoa("Fix the parser")}`,
				);
			});

			expect(await screen.findByText("Repository not found")).toBeTruthy();
			expect(create).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("says Repository not found when /create names a project that is not loaded", async () => {
		const { test, repo } = await seededTest();
		try {
			await renderApp(test, "/create?repo=missing-project&prompt=Hi");

			expect(await screen.findByText("Repository not found")).toBeTruthy();
			expect(screen.getByText('There is no project called "missing-project".')).toBeTruthy();
			// The dialog names its project in the project picker at its top left, as Conductor does.
			const repository = await screen.findByRole("button", { name: /^Project: / });
			expect(repository.textContent).toContain(repo.name);
		} finally {
			test.close();
		}
	});

	it("opens the create page with the project and prompt a link names", async () => {
		const { test, repo } = await seededTest();
		try {
			const router = await renderApp(test);

			act(() => {
				test.memory.controls.emitDeepLink(
					"conducted://?path=%2Fcode%2Fproject&branch=feature%2Ffix&prompt=Fix%20the%20login",
				);
			});

			await waitFor(() => expect(router.state.location.pathname).toBe("/create"));
			// The dialog names its project in the project picker at its top left, as Conductor does.
			const repository = await screen.findByRole("button", { name: /^Project: / });
			expect(repository.textContent).toContain(repo.name);
			expect((screen.getByLabelText("First message") as HTMLTextAreaElement).value).toBe(
				"Fix the login",
			);
			expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe("feature/fix");
		} finally {
			test.close();
		}
	});
});
