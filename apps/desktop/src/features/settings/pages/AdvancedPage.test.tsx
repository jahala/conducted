import { ok } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { AgentProgramView } from "../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AdvancedPage } from "./AdvancedPage.tsx";

const claude: AgentProgramView = {
	status: {
		program: "claude",
		state: "ready",
		version: "2.1.308",
		bytesDownloaded: 10,
		bytesTotal: 10,
		attempt: 0,
		nextAttemptAt: null,
		error: null,
		path: "/app/agent-binaries/claude/2.1.308/claude",
	},
	userPath: null,
};

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

	it("re-downloads an installed agent program from the Agent binaries section", async () => {
		const mounted = await mountPage();
		const redownload = vi.spyOn(mounted.container.platform.programs, "redownload");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: { state: "ready", data: [claude] },
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Re-download" }));

		expect(redownload).toHaveBeenCalledWith("claude");
	});

	it("offers Retry after a failed agent program download", async () => {
		const mounted = await mountPage();
		const install = vi.spyOn(mounted.container.platform.programs, "install");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						{
							...claude,
							status: {
								...claude.status,
								state: "failed",
								version: null,
								error: "The download was cut off.",
								path: null,
							},
						},
					],
				},
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		expect(install).toHaveBeenCalledWith("claude");
	});

	it("AGENT-09 installs Cursor's SDK from the Agent binaries section", async () => {
		const mounted = await mountPage();
		const install = vi.spyOn(mounted.container.platform.programs, "install");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						claude,
						{
							userPath: null,
							status: {
								...claude.status,
								program: "cursor",
								state: "missing",
								version: null,
								path: null,
							},
						},
					],
				},
			});
		});

		expect(await screen.findByText("Cursor SDK")).toBeTruthy();
		expect(screen.getByText("Not downloaded yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Install" }));

		expect(install).toHaveBeenCalledWith("cursor");
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
