/**
 * @feature CHAT-12 Plan review shortcut and Approve (issues #586, #595)
 * Owns: the browser check that Cmd+Shift+Enter approves a waiting plan from where focus sits in
 * Chromium, the composer, and from the plan bar itself; and that the bar's Approve button sends
 * typed composer text as the plan's adjustments (issue #595, renderApp @9313268).
 * Behaviour: Conductor registers "Approve plan" with the chat pane's commands, beside the composer's
 * own (renderApp @9295505), so the key works while the user types; the key is Enter with Cmd and
 * Shift (main @3795279). In Chromium the composer holds focus, and its editor (ProseMirror) prevents
 * the default of every Enter, which a jsdom key event without a key code never showed.
 * Must handle: focus in the composer when the state settles; focus on the bar's Approve button.
 * Our design choice: the check opens the catalogue state chat-plan-review in Playwright's Chromium
 * and presses the real keys; it does not move focus before the first case, so that case presses the
 * key wherever the app put focus.
 * Test first: approves the waiting plan with Cmd+Shift+Enter while the composer has focus.
 *
 * Usage: bun scripts/catalogue/plan-approve.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium, type Page } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { startServer, stopServer } from "./shots.ts";

/** The catalogue state: fjord's chat waits on a plan review. */
const STATE = "chat-plan-review";
/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;
/** Cmd is Meta in Chromium's key events, on every platform. */
const APPROVE_KEYS = "Meta+Shift+Enter";

/** The answer the state's sidecar logs on taking the plan's answer (states/chat.ts). */
const ANSWER_LOG = "[catalogue] answered interaction: ";
const APPROVED = JSON.stringify({ kind: "plan_approval", approved: true });
/** Text typed in the composer before Approve, and the answer that carries it. */
const ADJUSTMENTS = "Keep the old cache for reads.";
const ADJUSTED = JSON.stringify({ kind: "plan_approval", approved: false, feedback: ADJUSTMENTS });

/**
 * The first answer the sidecar takes from now on, as JSON, or null when none comes within the hang
 * limit. Call it before the key press, so the answer cannot arrive before the listener.
 */
async function answered(page: Page): Promise<string | null> {
	try {
		const message = await page.waitForEvent("console", {
			predicate: (line) => line.text().startsWith(ANSWER_LOG),
			timeout: HANG_MS,
		});
		return message.text().slice(ANSWER_LOG.length);
	} catch {
		return null;
	}
}

/** The focused element, named for a failure message. */
async function focused(page: Page): Promise<string> {
	return page.evaluate(() => {
		const element = document.activeElement;
		if (element === null) return "nothing";
		const label = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
		return `${element.tagName} role=${element.getAttribute("role") ?? ""} "${label.slice(0, 40)}"`;
	});
}

/** Opens the state as the screenshot run does: the catalogue's fixed time, motion reduced. */
async function open(browser: Browser, url: string): Promise<Page> {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	await page.clock.setFixedTime(CATALOGUE_NOW);
	const address = `${url}?${new URLSearchParams({ state: STATE, theme: "light" }).toString()}`;
	await page.goto(address, { timeout: HANG_MS });
	const html = page.locator("html[data-catalogue]");
	await html.waitFor({ state: "attached", timeout: HANG_MS });
	const status = await html.getAttribute("data-catalogue");
	if (status !== "ready") {
		throw new Error(
			`The state ${STATE} ended ${status}: ${await html.getAttribute("data-catalogue-error")}`,
		);
	}
	return page;
}

async function main(): Promise<number> {
	const server = startServer();
	let browser: Browser | null = null;
	let failed = 0;
	const check = (name: string, pass: boolean, detail: string): void => {
		if (!pass) failed += 1;
		console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: ${detail}`}`);
	};
	try {
		const url = await server.url;
		browser = await chromium.launch();

		// The deciding case: the key pressed where the app leaves focus, the composer.
		const typing = await open(browser, url);
		try {
			const composer = typing.getByRole("textbox", { name: "composer" });
			const inComposer = await composer.evaluate((node) => node.contains(document.activeElement));
			const where = await focused(typing);
			const answer = answered(typing);
			await typing.keyboard.press(APPROVE_KEYS);
			const got = await answer;
			check(
				"approves the waiting plan with Cmd+Shift+Enter while the composer has focus",
				inComposer && got === APPROVED,
				`focus ${where}, the sidecar got ${got ?? "no answer"}`,
			);
		} finally {
			await typing.close();
		}

		// The bar's own button keeps the key.
		const onBar = await open(browser, url);
		try {
			const approve = onBar
				.getByRole("group", { name: "Plan review" })
				.getByRole("button", { name: "Approve" });
			await approve.focus();
			const where = await focused(onBar);
			const answer = answered(onBar);
			await onBar.keyboard.press(APPROVE_KEYS);
			const got = await answer;
			check(
				"approves the waiting plan with Cmd+Shift+Enter from the bar's Approve button",
				got === APPROVED,
				`focus ${where}, the sidecar got ${got ?? "no answer"}`,
			);
		} finally {
			await onBar.close();
		}

		// The bar's Approve button sends typed text as the plan's adjustments (issue #595).
		const adjusting = await open(browser, url);
		try {
			await adjusting.getByRole("textbox", { name: "composer" }).click();
			await adjusting.keyboard.type(ADJUSTMENTS);
			const answer = answered(adjusting);
			await adjusting
				.getByRole("group", { name: "Plan review" })
				.getByRole("button", { name: "Approve" })
				.click();
			const got = await answer;
			check(
				"sends the composer's text as the plan's adjustments from the bar's Approve button",
				got === ADJUSTED,
				`the sidecar got ${got ?? "no answer"}`,
			);
		} finally {
			await adjusting.close();
		}
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error);
			process.exit(1);
		},
	);
}
