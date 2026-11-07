/**
 * @feature APP-06 UpdateNotice
 * Owns: tests for the sidebar notice, its restart dialog, its dismissal, the release notes link,
 * the "what's new" notice, the failure toast and the focus re-check.
 * Behaviour: ui-map.md 1.3 and 5.2; services-map.md 5B.4.1.
 * Test first: with state "ready_when_idle" and auto-restart off, the notice offers "Restart when
 * idle" and calls installUpdate once on click.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { UPDATE_FOCUS_RECHECK_MS } from "../../core/services/updates.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { UpdateNotice } from "./UpdateNotice.tsx";

const WORKING = { ...idleLiveState, status: "working" as const };

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	open?.close();
	open = null;
});

function build(): TestContainer {
	const test = createTestContainer();
	open = test;
	return test;
}

function setAuto(test: TestContainer, enabled: boolean): void {
	test.container.services.settings.store.setState((state) => ({
		values: { ...state.values, auto_restart_on_update_when_idle: enabled },
	}));
}

function setStatus(
	test: TestContainer,
	next: Parameters<typeof test.container.services.updates.store.setState>[0],
): void {
	test.container.services.updates.store.setState(next);
}

function renderNotice(test: TestContainer) {
	return render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<UpdateNotice />
			</AppProviders>
		</ServicesProvider>,
	);
}

function renderSidebar(test: TestContainer) {
	return renderWithRouter(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={test.container}>
				<Sidebar />
			</ServicesProvider>
		</AppProviders>,
	);
}

describe("APP-06 UpdateNotice", () => {
	it("offers Restart when idle and calls installUpdate once when automatic restart is off", async () => {
		const test = build();
		setAuto(test, false);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: "https://example.test/notes",
			error: null,
		});
		const install = vi.spyOn(test.container.actions.app, "installUpdate");

		renderNotice(test);

		expect(await screen.findByText("Version 0.2.0 is ready")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Restart when idle" }));
		await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
	});

	it("says the app restarts by itself and does not offer a restart when the setting is on", async () => {
		const test = build();
		setAuto(test, true);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: "https://example.test/notes",
			error: null,
		});

		renderNotice(test);

		expect(
			await screen.findByText("Will automatically restart when all agents are idle"),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Restart when idle" })).toBeNull();
		expect(screen.getByRole("button", { name: "See changes" })).toBeTruthy();
	});

	it("waits for idle agents in a dialog before it restarts", async () => {
		const test = build();
		setAuto(test, false);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: null,
			error: null,
		});
		test.container.services.sessions.store.setState({
			liveStates: { "chat-1": WORKING },
		});
		const install = vi.spyOn(test.container.actions.app, "installUpdate");
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");

		renderNotice(test);
		fireEvent.click(await screen.findByRole("button", { name: "Restart when idle" }));

		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Restart Conducted?")).toBeTruthy();
		expect(
			within(dialog).getByText(
				"Agents are still working. Conducted will restart when they are idle.",
			),
		).toBeTruthy();
		expect(install).not.toHaveBeenCalled();
		expect(relaunch).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Restart when idle" }));
		await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
	});

	it("opens the release notes and reports one that cannot be opened", async () => {
		const test = build();
		setAuto(test, false);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: "https://example.test/notes",
			error: null,
		});
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderNotice(test);
		fireEvent.click(await screen.findByRole("button", { name: "See changes" }));
		await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.test/notes"));

		openUrl.mockRejectedValueOnce(new Error("No browser"));
		fireEvent.click(screen.getByRole("button", { name: "See changes" }));
		expect(await screen.findByText("Couldn't open the release notes")).toBeTruthy();
		expect(screen.getByText("The link could not be opened.")).toBeTruthy();
	});

	it("stays dismissed for one version and returns for the next", async () => {
		const test = build();
		setAuto(test, false);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: null,
			error: null,
		});

		renderNotice(test);
		expect(await screen.findByText("Version 0.2.0 is ready")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));
		await waitFor(() => expect(screen.queryByText("Version 0.2.0 is ready")).toBeNull());

		act(() => {
			setStatus(test, {
				state: "ready_when_idle",
				version: "0.2.1",
				notesUrl: null,
				error: null,
			});
		});
		expect(await screen.findByText("Version 0.2.1 is ready")).toBeTruthy();
	});

	it("shows update failures as a toast, with a link to the release notes", async () => {
		const test = build();
		setStatus(test, {
			state: "error",
			version: "0.2.0",
			notesUrl: "https://example.test/notes",
			error: "The update feed answered 500",
		});
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderNotice(test);

		expect(await screen.findByText("Update failed")).toBeTruthy();
		expect(screen.getByText("The update feed answered 500")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "See changes" }));
		await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.test/notes"));
		// The action closes the toast, and sonner removes it on a timer. Wait until it has left the
		// page, so no timer is still pending when the file's test page is torn down (as in #341).
		await waitFor(() => expect(screen.queryByText("Update failed")).toBeNull());
	});

	it("shows what changed after an update until the last-seen key matches", async () => {
		const test = build();
		vi.spyOn(test.container.platform.updater, "installedUpdate").mockResolvedValue(
			ok({ version: "0.2.0", notes: "Faster diffs." }),
		);
		const save = vi.spyOn(test.container.actions.settings, "set");

		renderNotice(test);

		expect(await screen.findByText("What's new in 0.2.0")).toBeTruthy();
		expect(screen.getByText("Faster diffs.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss what's new" }));
		await waitFor(() => expect(save).toHaveBeenCalledWith("last_seen_announcement", "0.2.0"));
		await waitFor(() => expect(screen.queryByText("What's new in 0.2.0")).toBeNull());
	});

	it("does not show what changed once its version was seen", async () => {
		const test = build();
		test.container.services.settings.store.setState((state) => ({
			values: { ...state.values, last_seen_announcement: "0.2.0" },
		}));
		vi.spyOn(test.container.platform.updater, "installedUpdate").mockResolvedValue(
			ok({ version: "0.2.0", notes: "Faster diffs." }),
		);

		renderNotice(test);

		await waitFor(() => expect(test.container.platform.updater.installedUpdate).toHaveBeenCalled());
		expect(screen.queryByText("What's new in 0.2.0")).toBeNull();
	});

	it("checks again on focus after ten minutes, not before", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
		const test = build();
		const check = vi.spyOn(test.container.actions.app, "checkForUpdates");

		renderNotice(test);
		act(() => {
			test.memory.controls.emitWindowFocus(true);
		});
		expect(check).not.toHaveBeenCalled();

		act(() => {
			vi.setSystemTime(new Date(Date.now() + UPDATE_FOCUS_RECHECK_MS));
			test.memory.controls.emitWindowFocus(true);
		});
		expect(check).toHaveBeenCalledTimes(1);
	});

	it("is reachable from the real sidebar footer", async () => {
		const test = build();
		setAuto(test, false);
		setStatus(test, {
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: null,
			error: null,
		});

		renderSidebar(test);

		expect(await screen.findByText("Version 0.2.0 is ready")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Restart when idle" })).toBeTruthy();
	});

	it("shows download progress without an action", async () => {
		const test = build();
		setStatus(test, {
			state: "downloading",
			version: "0.2.0",
			notesUrl: null,
			error: null,
		});

		renderNotice(test);

		expect(await screen.findByText("Downloading version 0.2.0")).toBeTruthy();
	});

	it("turns a check failure into the notice's Retry action", async () => {
		const test = build();
		setStatus(test, {
			state: "error",
			version: null,
			notesUrl: null,
			error: "Could not reach the update feed",
		});
		const check = vi.spyOn(test.container.actions.app, "checkForUpdates");

		renderNotice(test);
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
	});

	it("shows the in-progress message when a Retry is refused", async () => {
		const test = build();
		setStatus(test, {
			state: "error",
			version: null,
			notesUrl: null,
			error: "Could not reach the update feed",
		});
		vi.spyOn(test.container.actions.app, "checkForUpdates").mockResolvedValue(
			err(appError("update_check_in_progress", "An update check is already in progress.")),
		);

		renderNotice(test);
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		expect(await screen.findByText("An update check is already in progress.")).toBeTruthy();
	});

	it("says so when the installed update cannot be read", async () => {
		const test = build();
		vi.spyOn(test.container.platform.updater, "installedUpdate").mockResolvedValue(
			err(appError("updater_read_failed", "The update record is missing")),
		);

		renderNotice(test);

		expect(await screen.findByText("Couldn't read the release notes")).toBeTruthy();
		expect(screen.getByText("The update record is missing")).toBeTruthy();
	});
});
