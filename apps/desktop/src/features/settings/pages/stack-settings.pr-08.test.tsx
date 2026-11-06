/**
 * @feature PR-08 Stacked PRs and read-only Graphite: the two settings
 * Owns: the container tests that the Git page shows "Use GitHub stacked PRs" and the Experimental
 * page shows "Graphite stack support" with Conductor's words, and that the Graphite switch is
 * positive on screen while its stored key stays the inverted `graphite_disabled`.
 * Behaviour: ui-map.md 6 (Git: "Use GitHub stacked PRs"; Experimental: "Graphite stack support"),
 * services-map.md 4.1.5 (the key says disabled, the toggle says support).
 * Test first: turning "Graphite stack support" off stores `graphite_disabled` as true.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { ExperimentalPage } from "./ExperimentalPage.tsx";
import { GitPage } from "./GitPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("PR-08 stack settings", () => {
	it("shows Use GitHub stacked PRs on the Git page in Conductor's words", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GitPage />
			</ServicesProvider>,
		);

		expect(screen.getByRole("switch", { name: "Use GitHub stacked PRs" })).toBeTruthy();
		expect(
			screen.getByText("Instruct agents that they can use `gh stack` for PR stacking."),
		).toBeTruthy();
		expect(screen.queryByText("Allow stacked pull requests")).toBeNull();
	});

	it("shows Graphite stack support switched on and stores the inverted key when turned off", async () => {
		test = createTestContainer();
		const harness = test;
		await harness.container.services.settings.start();
		render(
			<ServicesProvider container={harness.container}>
				<ExperimentalPage />
			</ServicesProvider>,
		);

		const toggle = screen.getByRole("switch", { name: "Graphite stack support" });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(
			screen.getByText(
				"Detect Graphite stacks for the active local workspace and show stack-aware UI in the git panel.",
			),
		).toBeTruthy();

		fireEvent.click(toggle);

		await waitFor(() =>
			expect(harness.container.services.settings.get<boolean>("graphite_disabled")).toBe(true),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("switch", { name: "Graphite stack support" }).getAttribute("aria-checked"),
			).toBe("false"),
		);
	});
});
