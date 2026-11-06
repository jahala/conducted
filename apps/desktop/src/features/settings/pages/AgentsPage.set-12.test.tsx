/**
 * @feature SET-12 Claude settings and Codex config editors, Claude in Chrome switch
 * Owns: tests for the controls this feature adds to the Agents page.
 * Behaviour: ui-map.md 6, "Agents page" (the Chrome switch, the Claude settings JSON editor and
 * the Codex config editor).
 * Must handle: turning the switch on, editing an existing config file, a missing file, and a file
 * that changed on disk while the editor was open.
 * Test first: turning on the Claude in Chrome switch stores chrome_mode_enabled.
 */
import type { AgentInstall } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AgentsPage } from "./AgentsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

const installs: AgentInstall[] = [
	{ agent: "claude", installed: true, authenticated: true },
	{ agent: "codex", installed: true, authenticated: true },
];

async function mount(options: Parameters<typeof createTestContainer>[0] = {}) {
	test = createTestContainer(options);
	const container = test.container;
	vi.spyOn(container.services.agentCatalog, "refresh").mockResolvedValue(ok(undefined));
	container.services.agentCatalog.setInstalls(installs);
	render(
		<ServicesProvider container={container}>
			<AgentsPage />
		</ServicesProvider>,
	);
	await screen.findByRole("heading", { name: "Claude Code" });
	return { container, fs: container.platform.fs };
}

/** Radix tabs switch on mouse down. */
function selectTab(name: string) {
	fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("SET-12 Agents page controls", () => {
	it("turns on Claude in Chrome and stores the setting", async () => {
		const { container } = await mount();
		const toggle = await screen.findByRole("switch", { name: "Use Claude Code with Chrome" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(toggle);

		await waitFor(() => expect(container.services.settings.get("chrome_mode_enabled")).toBe(true));
	});

	it("shows Claude's settings file and saves an edit", async () => {
		const { fs } = await mount();
		const path = `${fs.paths.home}/.claude/settings.json`;
		expect(await fs.writeTextAtomic(path, '{"model":"opus"}')).toEqual(ok(undefined));

		fireEvent.click(screen.getByRole("button", { name: "Claude settings" }));
		const dialog = await screen.findByRole("dialog");
		const editor = await within(dialog).findByRole("textbox", { name: "Claude settings" });
		await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('{"model":"opus"}'));

		fireEvent.change(editor, { target: { value: '{"model":"sonnet"}' } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

		await waitFor(async () => expect(await fs.readText(path)).toEqual(ok('{"model":"sonnet"}')));
	});

	it("shows Codex's config file and saves an edit", async () => {
		const { fs } = await mount();
		const path = `${fs.paths.home}/.codex/config.toml`;
		expect(await fs.writeTextAtomic(path, 'model = "gpt-5"\n')).toEqual(ok(undefined));

		// Each agent has its own tab, as in Conductor; Codex's config sits in the Codex tab.
		selectTab("Codex");
		fireEvent.click(await screen.findByRole("button", { name: "Codex config" }));
		const dialog = await screen.findByRole("dialog");
		const editor = await within(dialog).findByRole("textbox", { name: "Codex config" });
		await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('model = "gpt-5"\n'));

		fireEvent.change(editor, { target: { value: 'model = "gpt-5-codex"\n' } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

		await waitFor(async () =>
			expect(await fs.readText(path)).toEqual(ok('model = "gpt-5-codex"\n')),
		);
	});

	it("says a missing config file is created by saving", async () => {
		await mount();

		// Each agent has its own tab, as in Conductor; Codex's config sits in the Codex tab.
		selectTab("Codex");
		fireEvent.click(await screen.findByRole("button", { name: "Codex config" }));

		expect(
			await screen.findByText("This file does not exist yet. Saving creates it."),
		).toBeTruthy();
	});

	it("keeps the draft and says when the file changed on disk", async () => {
		let now = 1_700_000_000_000;
		const clock = { now: () => now };
		const { fs } = await mount({ clock });
		const path = `${fs.paths.home}/.claude/settings.json`;
		expect(await fs.writeTextAtomic(path, '{"model":"opus"}')).toEqual(ok(undefined));

		fireEvent.click(screen.getByRole("button", { name: "Claude settings" }));
		const dialog = await screen.findByRole("dialog");
		const editor = await within(dialog).findByRole("textbox", { name: "Claude settings" });
		await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('{"model":"opus"}'));

		now += 1_000;
		expect(await fs.writeTextAtomic(path, '{"model":"changed elsewhere"}')).toEqual(ok(undefined));
		fireEvent.change(editor, { target: { value: '{"model":"mine"}' } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

		expect(await within(dialog).findByText(/changed on disk/)).toBeTruthy();
		expect(await fs.readText(path)).toEqual(ok('{"model":"changed elsewhere"}'));
	});
});
