import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { GeneralPage } from "./pages/GeneralPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountGeneral(): Promise<TestContainer> {
	test = createTestContainer();
	await test.container.services.settings.start();
	render(
		<ServicesProvider container={test.container}>
			<GeneralPage />
		</ServicesProvider>,
	);
	return test;
}

async function openDialog() {
	fireEvent.click(screen.getByRole("button", { name: "Sync…" }));
	return within(await screen.findByRole("dialog"));
}

const homeOf = (mounted: TestContainer): string => mounted.container.platform.fs.paths.home;

describe("SET-08 General settings row and sync dialog", () => {
	it("SET-08 shows the row and offers the three categories", async () => {
		await mountGeneral();

		expect(screen.getByText("Sync agent configs")).toBeTruthy();
		const dialog = await openDialog();

		expect(dialog.getByRole("heading", { name: "Sync agent configs" })).toBeTruthy();
		for (const label of ["MCP servers", "Slash commands", "Skills"]) {
			const box = dialog.getByRole("checkbox", { name: label });
			expect(box.getAttribute("aria-checked")).toBe("true");
		}
	});

	it("SET-08 previews a change and copies it to the other agent", async () => {
		const mounted = await mountGeneral();
		const home = homeOf(mounted);
		mounted.memory.controls.addFolder(`${home}/.claude/commands`);
		mounted.memory.controls.files.set(`${home}/.claude/commands/review.md`, "Review the changes\n");

		const dialog = await openDialog();
		expect(await dialog.findByText("review")).toBeTruthy();
		expect(dialog.getByText("Add")).toBeTruthy();

		fireEvent.click(dialog.getByRole("button", { name: "Sync" }));

		expect(await dialog.findByText("Copied 1 entry.")).toBeTruthy();
		expect(
			await mounted.container.platform.fs.readText(`${home}/.codex/prompts/review.md`),
		).toEqual(ok("Review the changes\n"));
	});

	it("SET-08 lists the entries that could not be copied", async () => {
		const mounted = await mountGeneral();
		const home = homeOf(mounted);
		mounted.memory.controls.addFolder(`${home}/.claude/commands`);
		mounted.memory.controls.files.set(`${home}/.claude/commands/blocked.md`, "Blocked command\n");
		mounted.memory.controls.files.set(`${home}/.claude/commands/good.md`, "Good command\n");
		mounted.memory.controls.addFolder(`${home}/.codex/prompts/blocked.md`);

		const dialog = await openDialog();
		await dialog.findByText("blocked");
		fireEvent.click(dialog.getByRole("button", { name: "Sync" }));

		expect(await dialog.findByText("Copied 1 entry.")).toBeTruthy();
		expect(await dialog.findByText("Could not copy 1 entry:")).toBeTruthy();
		expect(dialog.getByText(/Slash commands blocked:/)).toBeTruthy();
		await expect(
			mounted.container.platform.fs.readText(`${home}/.codex/prompts/good.md`),
		).resolves.toEqual(ok("Good command\n"));
	});
});
