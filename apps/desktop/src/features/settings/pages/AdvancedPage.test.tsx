import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AdvancedPage } from "./AdvancedPage.tsx";

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
			<AdvancedPage />
		</ServicesProvider>,
	);
	return test;
}

describe("SET-02 AdvancedPage", () => {
	it("refuses a program path that does not exist and does not save it", async () => {
		const mounted = await mountPage();
		const set = vi.spyOn(mounted.container.actions.settings, "set");

		const input = screen.getByLabelText("Claude Code program path");
		fireEvent.change(input, { target: { value: "/definitely/not/here/claude" } });
		fireEvent.blur(input);

		expect(
			await screen.findByText("No program exists at /definitely/not/here/claude."),
		).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});

	it("asks before changing the root folder and saves the new path", async () => {
		const mounted = await mountPage();
		vi.spyOn(mounted.container.actions.app, "pickFolder").mockResolvedValue(ok("/tmp/new-root"));

		fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
		expect(await screen.findByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Change root path" }));

		await waitFor(() =>
			expect((screen.getByLabelText("Root folder") as HTMLInputElement).value).toBe(
				"/tmp/new-root",
			),
		);
	});
});
