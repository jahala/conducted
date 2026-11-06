/**
 * @feature PLAT-13 Self-update that waits until agents are idle
 * Owns: tests for the updates service's install-and-restart path and the quit check.
 * Test first: with the setting on, the state moves to a restart when the last working chat goes idle.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, err } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

const WORKING = { ...idleLiveState, status: "working" as const };

let current: TestContainer | null = null;

afterEach(() => {
	current?.close();
	current = null;
	vi.restoreAllMocks();
});

function build(): TestContainer {
	const test = createTestContainer();
	current = test;
	return test;
}

function setAuto(test: TestContainer, enabled: boolean): void {
	const settings = test.container.services.settings;
	settings.store.setState((state) => ({
		values: { ...state.values, auto_restart_on_update_when_idle: enabled },
	}));
}

function setWorking(test: TestContainer, working: boolean): void {
	test.container.services.sessions.store.setState({
		liveStates: working ? { "chat-1": WORKING } : {},
	});
}

describe("PLAT-13 UpdatesService.isSafeToQuit", () => {
	it("is safe to quit when no chat works and unsafe while one does", () => {
		const test = build();
		const updates = test.container.services.updates;
		expect(updates.isSafeToQuit()).toBe(true);
		setWorking(test, true);
		expect(updates.isSafeToQuit()).toBe(false);
		setWorking(test, false);
		expect(updates.isSafeToQuit()).toBe(true);
	});
});

describe("PLAT-13 UpdatesService.install", () => {
	it("stages the update and waits when automatic restart is off", async () => {
		const test = build();
		setAuto(test, false);
		const install = vi.spyOn(test.container.platform.updater, "install");
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");

		const installed = await test.container.actions.app.installUpdate();

		expect(installed.ok).toBe(true);
		expect(install).toHaveBeenCalledTimes(1);
		expect(relaunch).not.toHaveBeenCalled();
		expect(test.container.services.updates.store.getState()).toMatchObject({
			state: "ready_when_idle",
			error: null,
		});
	});

	it("restarts at once when automatic restart is on and no chat works", async () => {
		const test = build();
		setAuto(test, true);
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");

		const installed = await test.container.actions.app.installUpdate();

		expect(installed.ok).toBe(true);
		expect(relaunch).toHaveBeenCalledTimes(1);
		expect(test.container.services.updates.store.getState().state).toBe("idle");
	});

	it("keeps the update ready while a chat works", async () => {
		const test = build();
		setAuto(test, true);
		setWorking(test, true);
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");

		const installed = await test.container.actions.app.installUpdate();

		expect(installed.ok).toBe(true);
		expect(relaunch).not.toHaveBeenCalled();
		expect(test.container.services.updates.store.getState().state).toBe("ready_when_idle");
	});

	it("shows the download failure and never restarts", async () => {
		const test = build();
		setAuto(test, true);
		vi.spyOn(test.container.platform.updater, "install").mockResolvedValue(
			err(appError("updater_network", "The update file answered 500")),
		);
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");

		const installed = await test.container.actions.app.installUpdate();

		expect(installed.ok).toBe(false);
		expect(relaunch).not.toHaveBeenCalled();
		expect(test.container.services.updates.store.getState()).toMatchObject({
			state: "error",
			error: "The update file answered 500",
		});
	});
});

describe("PLAT-13 UpdatesService.onActivityChanged", () => {
	it("restarts once the last working chat goes idle", async () => {
		const test = build();
		const updates = test.container.services.updates;
		setAuto(test, true);
		setWorking(test, true);
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");
		await test.container.actions.app.installUpdate();
		expect(relaunch).not.toHaveBeenCalled();

		setWorking(test, false);
		updates.onActivityChanged();
		await vi.waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(updates.store.getState().state).toBe("idle"));

		updates.onActivityChanged();
		expect(relaunch).toHaveBeenCalledTimes(1);
	});

	it("does not restart when the setting is off", async () => {
		const test = build();
		const updates = test.container.services.updates;
		setAuto(test, false);
		const relaunch = vi.spyOn(test.container.platform.updater, "relaunch");
		await test.container.actions.app.installUpdate();

		setWorking(test, false);
		updates.onActivityChanged();

		expect(relaunch).not.toHaveBeenCalled();
		expect(updates.store.getState().state).toBe("ready_when_idle");
	});
});
