/**
 * The parity flows: one Chromium test per user flow of ui-map.md and services-map.md that the states
 * catalogue's app can drive, each starting from a catalogue state and asserting every step's visible
 * result. It writes `<out>/flows.json`, which `check.ts --flows` turns into check d's findings.
 * Behaviour: docs/plans/parity-harness.md section 3, check d. A browser run, so it runs on GitHub.
 * Our design choice: a flow the catalogue cannot drive yet is still listed, with one failing step that
 * says what it lacks, so no flow is dropped without a trace. A step waits for its result as an event
 * (a locator that appears); the timeout only catches a hang.
 * Must handle: a step that fails ends its flow (later steps depend on it); a state that does not
 * settle fails the flow's first step with the catalogue's reason; the server's process group is
 * stopped on every ending.
 *
 * Usage: bun scripts/parity/flows.ts [--out <dir>] [flow-id ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { startServer, stopServer } from "../catalogue/shots.ts";
import type { FlowResult } from "./check.ts";
import { ROOT } from "./lib.ts";

/** Catches a step that hangs. It is not a way to wait. */
const HANG_MS = 15_000;

interface Step {
	step: string;
	run(page: Page): Promise<void>;
}

interface Flow {
	id: string;
	title: string;
	source: string;
	/** The catalogue state the flow starts from. */
	state: string;
	steps: Step[];
	/** Why the catalogue cannot drive it yet; set for a flow that is listed but not run. */
	notDrivable?: string;
}

const visible = async (page: Page, selector: string, text?: string): Promise<void> => {
	const base = page.locator(selector);
	const target = text === undefined ? base : base.filter({ hasText: text });
	await target.first().waitFor({ state: "visible", timeout: HANG_MS });
};

/** Waits until an element whose own text is `text` is visible and not inside `outside`. */
const shownOutside = async (page: Page, text: string, outside: string): Promise<void> => {
	await page.waitForFunction(
		([wanted, excluded]) =>
			[...document.querySelectorAll("body *")].some(
				(element) =>
					element.children.length === 0 &&
					element.textContent?.trim() === wanted &&
					element.closest(excluded) === null &&
					element.getBoundingClientRect().height > 0,
			),
		[text, outside] as const,
		{ timeout: HANG_MS },
	);
};

export const FLOWS: Flow[] = [
	{
		id: "open-workspace",
		title: "Open a workspace from the sidebar",
		source: "ui-map.md 4",
		state: "sidebar",
		steps: [
			{
				step: "Click the rate-limit workspace's row",
				run: (page) => page.locator("a", { hasText: "rate-limit" }).first().click(),
			},
			{
				step: "Its chat opens with the composer",
				run: (page) => visible(page, '[data-testid="composer-editor"]'),
			},
		],
	},
	{
		id: "create-workspace",
		title: "Create a workspace",
		source: "ui-map.md 3.9; services-map.md 3.1",
		state: "sidebar",
		steps: [
			{
				step: "Click Create in the sidebar",
				run: (page) =>
					page.locator('nav[aria-label="Main"] a', { hasText: "Create" }).first().click(),
			},
			{
				step: "The new workspace composer asks what to work on",
				run: (page) => visible(page, "textarea,[contenteditable=true]"),
			},
			{
				step: "Type a task and press Create",
				run: async (page) => {
					await page.keyboard.type("Add a health check route");
					await page
						.getByRole("button", { name: /^Create/ })
						.first()
						.click();
				},
			},
			{
				step: "The new workspace opens on its chat",
				run: (page) => visible(page, '[data-testid="composer-editor"]'),
			},
		],
	},
	{
		id: "chat-send",
		title: "Send a message in a chat",
		source: "ui-map.md 3.3 and 3.5; services-map.md 2.3.4",
		state: "composer-empty",
		steps: [
			{
				step: "Type a message and press Enter",
				run: async (page) => {
					await page
						.locator('[data-testid="composer-editor"] [contenteditable=true]')
						.first()
						.click();
					await page.keyboard.type("Also log the redirect target");
					await page.keyboard.press("Enter");
				},
			},
			{
				step: "The message shows in the chat, outside the composer",
				run: (page) =>
					shownOutside(page, "Also log the redirect target", '[data-testid="composer-editor"]'),
			},
		],
	},
	{
		id: "open-diff",
		title: "Open a changed file's diff",
		source: "ui-map.md 3.6; services-map.md 3.4",
		state: "git-changes",
		steps: [
			{
				step: "Click sign-in.ts in the Changes list",
				run: (page) => page.getByText("sign-in.ts", { exact: true }).first().click(),
			},
			{
				step: "The diff opens in a tab, with its layout toggles",
				run: (page) =>
					visible(page, 'button[aria-label="Unified view"],button[title="Unified view"]'),
			},
		],
	},
	{
		id: "create-pr",
		title: "Create a pull request",
		source: "ui-map.md 3.6; services-map.md 3.7.1",
		state: "pr-none",
		steps: [
			{
				step: "Click Create PR in the git panel's header",
				run: (page) =>
					page
						.getByRole("button", { name: /Create PR/ })
						.first()
						.click(),
			},
			{
				step: "The header shows the new pull request's number",
				run: (page) =>
					page.getByText(/^#\d+/).first().waitFor({ state: "visible", timeout: HANG_MS }),
			},
		],
	},
	{
		id: "change-setting",
		title: "Change a setting",
		source: "ui-map.md 6",
		state: "settings-general",
		steps: [
			{
				step: "Flip the first switch on General",
				run: async (page) => {
					const toggle = page.locator("[role=switch]").first();
					const before = await toggle.getAttribute("aria-checked");
					await toggle.click();
					await page.waitForFunction(
						(was) => document.querySelector("[role=switch]")?.getAttribute("aria-checked") !== was,
						before,
						{ timeout: HANG_MS },
					);
				},
			},
		],
	},
	{
		id: "palette-to-settings",
		title: "Open settings from the command palette",
		source: "ui-map.md 5.1",
		state: "command-palette",
		steps: [
			{
				step: "Type Settings and press Enter",
				run: async (page) => {
					await page.keyboard.type("Settings");
					await page.keyboard.press("Enter");
				},
			},
			{
				step: "The settings navigation shows",
				run: (page) => visible(page, 'nav[aria-label="Settings"]'),
			},
		],
	},
	{
		id: "add-project-open",
		title: "Add a project: Open project",
		source: "ui-map.md 3.9 and 7.1",
		state: "first-run",
		steps: [],
		notDrivable:
			"the catalogue's folder dialog has no answer queued and no state scripts git for a new folder",
	},
	{
		id: "add-project-github",
		title: "Add a project: Open GitHub project",
		source: "ui-map.md 3.9",
		state: "first-run",
		steps: [],
		notDrivable: "no catalogue state scripts gh repo list or git clone",
	},
	{
		id: "add-project-quick-start",
		title: "Add a project: Quick start",
		source: "ui-map.md 3.9",
		state: "first-run",
		steps: [],
		notDrivable: "no catalogue state scripts the template copy and git init",
	},
];

async function runFlow(browser: Browser, url: string, flow: Flow): Promise<FlowResult> {
	const result: FlowResult = { id: flow.id, title: flow.title, source: flow.source, steps: [] };
	if (flow.notDrivable !== undefined) {
		result.steps.push({
			step: "Drive it in the catalogue",
			ok: false,
			detail: `not drivable: ${flow.notDrivable}`,
		});
		return result;
	}
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
		colorScheme: "light",
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	await page.clock.setFixedTime(CATALOGUE_NOW);
	try {
		await page.goto(
			`${url}?${new URLSearchParams({ state: flow.state, theme: "light" }).toString()}`,
		);
		await page.locator("html[data-catalogue]").waitFor({ state: "attached", timeout: 60_000 });
		const status = await page.locator("html").getAttribute("data-catalogue");
		if (status !== "ready") {
			const reason = await page.locator("html").getAttribute("data-catalogue-error");
			result.steps.push({
				step: `Open ${flow.state}`,
				ok: false,
				detail: reason ?? "did not settle",
			});
			return result;
		}
		for (const step of flow.steps) {
			try {
				await step.run(page);
				result.steps.push({ step: step.step, ok: true });
			} catch (cause) {
				const message = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
				result.steps.push({ step: step.step, ok: false, detail: message });
				break;
			}
		}
		return result;
	} finally {
		await context.close();
	}
}

async function main(argv: string[]): Promise<number> {
	let out = join(ROOT, ".context/parity");
	const only: string[] = [];
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (arg === "--out") out = resolve(argv[++index] ?? "");
		else only.push(arg);
	}
	mkdirSync(out, { recursive: true });
	const server = startServer();
	let browser: Browser | null = null;
	try {
		const url = await server.url;
		browser = await chromium.launch();
		const results: FlowResult[] = [];
		for (const flow of FLOWS.filter((item) => only.length === 0 || only.includes(item.id))) {
			const result = await runFlow(browser, url, flow);
			const passed = result.steps.every((step) => step.ok);
			console.log(`${passed ? "ok  " : "GAP "} ${flow.id}`);
			for (const step of result.steps.filter((item) => !item.ok))
				console.log(`       ${step.step}: ${step.detail}`);
			results.push(result);
		}
		writeFileSync(join(out, "flows.json"), `${JSON.stringify(results, null, "\t")}\n`);
		return 0;
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
