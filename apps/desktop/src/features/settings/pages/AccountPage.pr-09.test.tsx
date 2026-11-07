/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: tests for the Account page's Linear connection status.
 * Behaviour: ui-map.md 6 (Account: Linear connection and key), D035 (a rejected key says so).
 * Test first: a rejected key shows that Linear rejected it, above the key field.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { AccountPage } from "./AccountPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountPage() {
	test = createTestContainer();
	await test.container.services.settings.start();
	render(
		<ServicesProvider container={test.container}>
			<AccountPage />
		</ServicesProvider>,
	);
	return test.container;
}

describe("PR-09 Account Linear connection", () => {
	it("shows the connected Linear account", async () => {
		const container = await mountPage();
		act(() => {
			container.services.linear.store.setState({
				connection: "connected",
				account: { name: "Ada", organization: "Acme" },
			});
		});
		expect(await screen.findByText("Connected as Ada (Acme)")).toBeTruthy();
	});

	it("shows that Linear rejected the key", async () => {
		const container = await mountPage();
		act(() => {
			container.services.linear.store.setState({ connection: "key_rejected" });
		});
		expect(await screen.findByText(/Linear rejected the API key/)).toBeTruthy();
	});

	it("shows that Linear is not connected", async () => {
		const container = await mountPage();
		act(() => {
			container.services.linear.store.setState({ connection: "not_connected" });
		});
		expect(await screen.findByText("Not connected")).toBeTruthy();
	});
});
