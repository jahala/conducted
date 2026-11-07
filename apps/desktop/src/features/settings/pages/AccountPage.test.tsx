import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { GithubAccess } from "../../../core/services/github.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { AccountPage } from "./AccountPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountPage(access: GithubAccess) {
	test = createTestContainer();
	await test.container.services.settings.start();
	test.container.services.github.store.setState((state) => ({ ...state, access }));
	render(
		<ServicesProvider container={test.container}>
			<AccountPage />
		</ServicesProvider>,
	);
	return test.container;
}

/** Conductor keeps GitHub's sign-in, token and method behind the row's one button. */
async function openGitHub(name: "Manage" | "Connect") {
	const row = await screen.findByRole("region", { name: "GitHub" });
	fireEvent.click(within(row).getByRole("button", { name }));
	return screen.findByRole("dialog", { name: "GitHub" });
}

describe("SET-02 AccountPage", () => {
	it("shows install help and no sign-in command when gh is missing", async () => {
		await mountPage({ status: "gh_missing" });
		await openGitHub("Connect");

		expect(await screen.findByText(/The GitHub CLI \(gh\) is not installed/)).toBeTruthy();
		expect(screen.getByText(/Install the GitHub CLI from/)).toBeTruthy();
		expect(screen.queryByText(/gh auth login/)).toBeNull();
	});

	it("shows the saml single sign-on failure on the account page", async () => {
		await mountPage({ status: "signed_out", failure: "saml-sso-required" });
		await openGitHub("Connect");

		expect(await screen.findByText(/single sign-on/i)).toBeTruthy();
	});

	it("confirms a token that does not look like a GitHub token before saving it", async () => {
		const container = await mountPage({
			status: "ok",
			login: "octocat",
			host: "github.com",
			scopes: ["repo"],
			usesToken: false,
			gitProtocol: "https",
		});
		const setToken = vi
			.spyOn(container.actions.accounts, "setGitHubToken")
			.mockResolvedValue(ok(undefined));
		await openGitHub("Manage");

		fireEvent.change(screen.getByLabelText("Personal access token"), {
			target: { value: "not a token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save token" }));

		expect(await screen.findByRole("alertdialog")).toBeTruthy();
		expect(setToken).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
		await waitFor(() => expect(setToken).toHaveBeenCalledWith("not a token"));
	});

	it("heads the page with the GitHub sign-in and a Manage action, as Conductor's profile block", async () => {
		await mountPage({
			status: "ok",
			login: "octo",
			host: "github.com",
			scopes: [],
			usesToken: false,
			gitProtocol: null,
		});

		expect(await screen.findByText("Signed in to github.com with gh")).toBeTruthy();
		expect(screen.getByText("O")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
	});

	it("opens the Linear key form from Connect", async () => {
		await mountPage({ status: "gh_missing" });

		expect(screen.queryByLabelText("Linear API key")).toBeNull();
		const linear = await screen.findByRole("region", { name: "Linear" });
		fireEvent.click(within(linear).getByRole("button", { name: "Connect" }));
		expect(screen.getByLabelText("Linear API key")).toBeTruthy();
	});

	// Conductor's Linear row has a Refresh beside its button (renderApp YVe, @10816324).
	it("checks Linear again from the Linear row's Refresh", async () => {
		const container = await mountPage({ status: "signed_out" });
		// A connection shown from an earlier check; the Keychain no longer holds a key.
		container.services.linear.store.setState({
			connection: "connected",
			account: { name: "Ada", organization: null },
		});
		const linear = await screen.findByRole("region", { name: "Linear" });
		expect(await within(linear).findByText("Connected as Ada")).toBeTruthy();

		const refresh = within(linear).getByRole("button", { name: "Refresh" });
		expect(refresh.querySelector("svg")).not.toBeNull();
		fireEvent.click(refresh);

		expect(await within(linear).findByText("Not connected")).toBeTruthy();
		expect(within(linear).getByRole("button", { name: "Connect" })).toBeTruthy();
	});

	it("keeps GitHub's sign-in, token and method in the dialog its one button opens, as Conductor does", async () => {
		await mountPage({
			status: "ok",
			login: "octo",
			host: "github.com",
			scopes: ["repo"],
			usesToken: false,
			gitProtocol: null,
		});
		const row = await screen.findByRole("region", { name: "GitHub" });
		expect(
			within(row)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["Manage"]);
		expect(screen.queryByLabelText("Personal access token")).toBeNull();
		expect(document.querySelector('[data-setting-key="gh_auth_method"]')).toBeNull();

		const dialog = await openGitHub("Manage");
		expect(
			within(dialog).getByText(
				"Choose how Conducted authenticates GitHub operations on your machine.",
			),
		).toBeTruthy();
		expect(within(dialog).getByText(/Signed in as octo on github.com/)).toBeTruthy();
		expect(within(dialog).getByLabelText("Personal access token")).toBeTruthy();
		expect(within(dialog).getByRole("button", { name: "Check again" })).toBeTruthy();
		expect(dialog.querySelector('[data-setting-key="gh_auth_method"]')).not.toBeNull();
	});
});
