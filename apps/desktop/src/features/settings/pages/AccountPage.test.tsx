import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { GithubAccess } from "../../../core/services/github.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
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

describe("SET-02 AccountPage", () => {
	it("shows install help and no sign-in command when gh is missing", async () => {
		await mountPage({ status: "gh_missing" });

		expect(await screen.findByText(/The GitHub CLI \(gh\) is not installed/)).toBeTruthy();
		expect(screen.getByText(/Install the GitHub CLI from/)).toBeTruthy();
		expect(screen.queryByText(/gh auth login/)).toBeNull();
	});

	it("shows the saml single sign-on failure on the account page", async () => {
		await mountPage({ status: "signed_out", failure: "saml-sso-required" });

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
		fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
		expect(screen.getByLabelText("Linear API key")).toBeTruthy();
	});
});
