import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CommandRunner,
	type CommandServices,
	commandRequirement,
	createCommandHandlers,
} from "./command-runner.ts";

const allContext = () => ({ hasWorkspace: true, hasOpenPr: true, hasOpenChat: true });
const noContext = () => ({ hasWorkspace: false, hasOpenPr: false, hasOpenChat: false });

function fakeServices() {
	const addLocal = vi.fn(async (_path: string): Promise<Result<never>> => ok(undefined as never));
	const check = vi.fn(async () => ok(undefined));
	const openSidecarLogs = vi.fn(async () => ok(undefined));
	const services = {
		repo: { addLocal },
		updates: { check },
		system: { openSidecarLogs },
	} as unknown as CommandServices;
	return { services, addLocal, check, openSidecarLogs };
}

describe("NAV-07 CommandRunner.run", () => {
	it("returns an error value for an id the registry does not know", async () => {
		const runner = new CommandRunner({ handlers: () => ({}), context: allContext });
		const result = await runner.run("nope.nothing");
		expect(result).toMatchObject({ ok: false, error: { code: "command_unknown" } });
	});

	it("returns command_unavailable for a known id with no handler", async () => {
		const runner = new CommandRunner({ handlers: () => ({}), context: allContext });
		const result = await runner.run("workspace.create");
		expect(result).toMatchObject({ ok: false, error: { code: "command_unavailable" } });
	});

	it("runs the handler registered for a known command", async () => {
		const handler = vi.fn(async () => ok(undefined));
		const runner = new CommandRunner({
			handlers: () => ({ "workspace.create": handler }),
			context: allContext,
		});
		const result = await runner.run("workspace.create");
		expect(handler).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: true, value: undefined });
	});

	it("passes a handler failure through unchanged", async () => {
		const failure = appError("repo_path_missing", "Choose a folder to add.");
		const runner = new CommandRunner({
			handlers: () => ({ "workspace.create": async () => err(failure) }),
			context: allContext,
		});
		expect(await runner.run("workspace.create")).toEqual({ ok: false, error: failure });
	});

	it("refuses a command whose context is not met", async () => {
		const handler = vi.fn(async () => ok(undefined));
		const runner = new CommandRunner({
			handlers: () => ({ "workspace.archive": handler }),
			context: noContext,
		});
		const result = await runner.run("workspace.archive");
		expect(result).toMatchObject({ ok: false, error: { code: "command_disabled" } });
		expect(handler).not.toHaveBeenCalled();
	});

	it("runs one command once when two runs start at the same time", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const handler = vi.fn(async () => {
			await gate;
			return ok(undefined);
		});
		const runner = new CommandRunner({
			handlers: () => ({ "workspace.create": handler }),
			context: allContext,
		});
		const first = runner.run("workspace.create");
		const second = runner.run("workspace.create");
		expect(handler).toHaveBeenCalledTimes(1);
		release();
		await Promise.all([first, second]);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

describe("NAV-07 CommandRunner.isEnabled", () => {
	it("needs a workspace, an open pull request or an open chat only where it says so", () => {
		expect(commandRequirement("pr.merge")).toBe("hasOpenPr");
		expect(commandRequirement("chat.submit")).toBe("hasOpenChat");
		expect(commandRequirement("git.createPr")).toBe("hasWorkspace");
		expect(commandRequirement("nav.quickOpenFile")).toBe("hasWorkspace");
		expect(commandRequirement("app.quit")).toBeNull();
	});

	it("answers from the live context and refuses an unknown id", () => {
		const empty = new CommandRunner({ handlers: () => ({}), context: noContext });
		expect(empty.isEnabled("app.quit")).toBe(true);
		expect(empty.isEnabled("workspace.create")).toBe(true);
		expect(empty.isEnabled("workspace.archive")).toBe(false);
		expect(empty.isEnabled("pr.merge")).toBe(false);
		expect(empty.isEnabled("chat.submit")).toBe(false);
		expect(empty.isEnabled("nope.nothing")).toBe(false);

		const full = new CommandRunner({ handlers: () => ({}), context: allContext });
		expect(full.isEnabled("workspace.archive")).toBe(true);
		expect(full.isEnabled("pr.merge")).toBe(true);
		expect(full.isEnabled("chat.submit")).toBe(true);
	});
});

describe("NAV-07 createCommandHandlers", () => {
	it("wires project.add to the picker and the add-project flow", async () => {
		const { services, addLocal } = fakeServices();
		const pickFolder = vi.fn(async (_title: string): Promise<string | null> => "/code/app");
		const handlers = createCommandHandlers(services, { pickFolder });
		const handler = handlers["project.add"];
		expect(handler).toBeDefined();
		expect(await handler?.()).toEqual({ ok: true, value: undefined });
		expect(pickFolder).toHaveBeenCalledWith("Add a project");
		expect(addLocal).toHaveBeenCalledWith("/code/app");
	});

	it("does nothing when the folder dialog is cancelled", async () => {
		const { services, addLocal } = fakeServices();
		const pickFolder = vi.fn(async (_title: string): Promise<string | null> => null);
		const handlers = createCommandHandlers(services, { pickFolder });
		expect(await handlers["project.add"]?.()).toEqual({ ok: true, value: undefined });
		expect(addLocal).not.toHaveBeenCalled();
	});

	it("returns the add failure without inventing success", async () => {
		const { services, addLocal } = fakeServices();
		const failure = appError("repo_path_missing", "Choose a folder to add.");
		addLocal.mockResolvedValueOnce(err(failure));
		const handlers = createCommandHandlers(services, {
			pickFolder: async () => "/code/nope",
		});
		expect(await handlers["project.add"]?.()).toEqual({ ok: false, error: failure });
	});

	it("leaves project.add out until a folder picker is wired", () => {
		const { services } = fakeServices();
		expect(createCommandHandlers(services)["project.add"]).toBeUndefined();
	});

	it("wires the service-level commands that exist today", async () => {
		const { services, check, openSidecarLogs } = fakeServices();
		const handlers = createCommandHandlers(services);
		expect(await handlers["app.checkForUpdates"]?.()).toEqual({ ok: true, value: undefined });
		expect(await handlers["app.openSidecarLogs"]?.()).toEqual({ ok: true, value: undefined });
		expect(check).toHaveBeenCalledTimes(1);
		expect(openSidecarLogs).toHaveBeenCalledTimes(1);
	});
});
