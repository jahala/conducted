/**
 * @feature n16-s1-ui-1 Join the batch's features through the composition root
 * Owns: one test per feature of the batch (APP-09, CHAT-26, CHAT-28, CHAT-29, CHAT-30, COMP-05,
 * COMP-08, COMP-09), each driven through createTestContainer and the app's own root route, so
 * the container wiring, the overlay host and the workspace screen are the ones the app mounts.
 * Behaviour: D054 (a feature is reachable from the composition root), D058 (the joining node).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import { idleLiveState, type SessionConfig, type SessionEvent } from "@conducted/protocol";
import { type EventId, type MessageId, ok, type Result, type TurnId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app root exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app root exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app root exactly as the app does
import { createAppRouter } from "../app/router.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test reads the snippet dialogs the root mounts
import { useSnippetDialogsStore } from "../features/composer/snippet-dialogs-store.ts";
import type { ShellOutput } from "../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedUserMessage,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import "../test/dom-polyfills.ts";
// biome-ignore lint/style/noRestrictedImports: the join test clears the toasts the app root shows
import { toast } from "../ui/Toast.tsx";
import { ServicesProvider } from "./context.tsx";
import type { Session, Workspace } from "./model.ts";
import { FEEDBACK_ISSUE_URL } from "./services/system.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const REMOTE = "https://github.com/octo/repo.git";

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const opened: TestContainer[] = [];

afterEach(async () => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	useOverlayStore.getState().close();
	useSnippetDialogsStore.getState().close();
	for (const test of opened.splice(0)) {
		await test.container.stop();
		test.close();
	}
});

let nextEvent = 0;

function userMessage(text: string, at: number, attachmentPaths: string[] = []) {
	nextEvent += 1;
	return {
		type: "user_message",
		eventId: `join-${nextEvent}` as EventId,
		at,
		messageId: `join-message-${nextEvent}` as MessageId,
		turnId: `join-turn-${nextEvent}` as TurnId,
		text,
		attachmentPaths,
		delivery: "new_turn",
		config: CONFIG,
	} as Extract<SessionEvent, { type: "user_message" }>;
}

function usageEvent(contextUsedTokens: number): SessionEvent {
	nextEvent += 1;
	return {
		eventId: `join-${nextEvent}` as EventId,
		at: nextEvent,
		type: "agent",
		turnId: "join-usage-turn" as TurnId,
		message: {
			agent: "claude",
			items: [
				{
					kind: "usage",
					inputTokens: 100,
					outputTokens: 20,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					contextUsedTokens,
					contextWindowTokens: 100_000,
				},
			],
		},
	} as SessionEvent;
}

interface Mounted {
	test: TestContainer;
	workspace: Workspace;
	session: Session;
}

/** A project with a GitHub remote, one workspace and one chat, before the screen mounts. */
async function seed(config: SessionConfig = CONFIG): Promise<Mounted> {
	const test = createTestContainer();
	opened.push(test);
	must(await test.container.services.settings.start());
	const repo = await seedRepo(test.container, { remoteUrl: REMOTE });
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		directoryName: "login",
	});
	const session = must(await test.container.services.sessions.create(workspace.id, config));
	return { test, workspace, session };
}

/** Mounts the app's own root route on the chat, as opening the workspace does. */
async function mountChat({ test, workspace, session }: Mounted): Promise<void> {
	const router = createAppRouter(
		createMemoryHistory({
			initialEntries: [
				`/repository/${workspace.repoId}/workspace/${workspace.id}?tab=session&sessionId=${session.id}`,
			],
		}),
	);
	const tree: ReactNode = (
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<RouterProvider router={router} />
				</VirtuosoMockContext.Provider>
			</AppProviders>
		</ServicesProvider>
	);
	render(tree);
	await router.load();
	await screen.findByLabelText("composer");
}

describe("n16-s1-ui-1 join: every feature of the batch runs from the app root", () => {
	it("APP-09 Cmd+Alt+F opens Feedback, and sending opens the project's issue page", async () => {
		const mounted = await seed();
		// seam: APP-09 the browser is outside the app; the test reads the URL it would open.
		const openUrl = vi.spyOn(mounted.test.container.platform.opener, "openUrl").mockResolvedValue();
		await mountChat(mounted);

		fireEvent.keyDown(document, { key: "f", metaKey: true, altKey: true });
		await screen.findByRole("dialog", { name: "Feedback" });
		fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Works well" } });
		fireEvent.click(screen.getByRole("button", { name: /Send feedback/ }));

		expect(await screen.findByText("Thank you for your feedback!")).toBeTruthy();
		expect(String(openUrl.mock.calls[0]?.[0]).startsWith(`${FEEDBACK_ISSUE_URL}?`)).toBe(true);
	});

	it("CHAT-26 an empty chat attaches an earlier chat's transcript to its composer", async () => {
		const mounted = await seed();
		const earlier = must(
			await mounted.test.container.services.sessions.create(mounted.workspace.id, CONFIG),
		);
		must(await mounted.test.container.services.sessions.rename(earlier.id, "Login fix"));
		await seedUserMessage(mounted.test.container, earlier.id, userMessage("Fix the login", 10), 10);
		await mountChat(mounted);

		expect(await screen.findByText("Add chat transcripts:")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Login fix" }));

		expect(
			await screen.findByRole("button", { name: "Remove Transcript of Login fix.md" }),
		).toBeTruthy();
	});

	it("CHAT-28 the context card asks the sidecar and shows the plan usage and account", async () => {
		const mounted = await seed();
		mounted.test.container.services.settings.store.setState((state) => ({
			...state,
			values: { ...state.values, always_show_context_wheel: true },
		}));
		const sidecar = mounted.test.container.sidecar;
		const passOn = sidecar.request.bind(sidecar);
		// seam: CHAT-28 the sidecar is another process; the test gives its usage answer.
		vi.spyOn(sidecar, "request").mockImplementation(((method: string, params: never) =>
			method === "getContextUsage"
				? Promise.resolve(
						ok({
							usedTokens: 40_000,
							windowTokens: 100_000,
							rateLimits: [{ label: "5-hour limit", usedPercent: 30, windowMinutes: 300 }],
							account: { plan: "Max", loginMethod: "Claude account" },
						}),
					)
				: passOn(method as never, params)) as never);
		await mountChat(mounted);
		act(() =>
			mounted.test.container.services.sessions.applyStoredEvent(
				mounted.session.id,
				0,
				usageEvent(40_000),
				1000,
			),
		);

		fireEvent.focus(await screen.findByRole("button", { name: "Context usage: 40%" }));

		expect(await screen.findByText("Claude usage")).toBeTruthy();
		expect(screen.getByText("70% left")).toBeTruthy();
		expect(screen.getByText("Claude account")).toBeTruthy();
	});

	it("CHAT-29 an image in the user's message opens with Copy image and Open in default app", async () => {
		const mounted = await seed();
		const image = "/Users/me/shot.png";
		mounted.test.memory.controls.files.set(image, "png");
		await seedUserMessage(
			mounted.test.container,
			mounted.session.id,
			userMessage("Look at this", 10, [image]),
			10,
		);
		await mountChat(mounted);

		fireEvent.click(await screen.findByRole("button", { name: "Open shot.png" }));

		expect(await screen.findByRole("heading", { name: "shot.png" })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Copy image/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Open in default app/ })).toBeTruthy();
	});

	it("CHAT-30 a chat whose fast mode was refused shows the out-of-credits banner", async () => {
		const mounted = await seed({ ...CONFIG, fastMode: true });
		must(
			await mounted.test.container.services.sessions.applyLiveState(mounted.session.id, {
				...idleLiveState,
				fastModeAvailable: false,
			}),
		);
		await mountChat(mounted);

		expect(
			await screen.findByText("Fast mode is disabled because extra usage is out of credits."),
		).toBeTruthy();
	});

	it("COMP-05 typing # in the composer lists the repository's pull requests", async () => {
		const mounted = await seed();
		mounted.test.container.services.github.store.setState((state) => ({
			...state,
			access: {
				status: "ok",
				login: "octo",
				host: "github.com",
				scopes: ["repo"],
				usesToken: false,
				gitProtocol: "https",
			},
		}));
		const shell = (stdout: string): Result<ShellOutput> => ok({ exitCode: 0, stdout, stderr: "" });
		mounted.test.memory.controls.scriptShell((command) => {
			const args = command.args.join(" ");
			if (command.program === "git" && args.includes("remote get-url")) return shell(`${REMOTE}\n`);
			if (command.program !== "gh") return null;
			if (args.includes("pulls?")) {
				return shell(
					JSON.stringify([
						{
							number: 12,
							title: "Fix the mention trigger",
							html_url: "https://github.com/octo/repo/pull/12",
							state: "open",
							updated_at: "2026-11-05T10:00:00Z",
							body: "",
							head: { ref: "fix-mention" },
							user: { login: "octo" },
						},
					]),
				);
			}
			if (args.includes("issues?")) return shell("[]");
			return null;
		});
		await mountChat(mounted);
		const field = await screen.findByLabelText("composer");
		// TipTap hangs its editor on the element it draws into.
		const editor = (field as unknown as { editor: Editor }).editor;

		act(() => editor.commands.insertContent("#12"));
		const row = await screen.findByRole("option", { name: /#12/ });
		expect(row.textContent).toContain("Fix the mention trigger");
	});

	it("COMP-08 the composer's dictation button starts the recognizer", async () => {
		const mounted = await seed();
		mounted.test.container.services.settings.store.setState((state) => ({
			...state,
			values: { ...state.values, voice_mode: true },
		}));
		// seam: COMP-08 speech recognition is the Mac's; the test says it is there and sees the start.
		vi.spyOn(mounted.test.container.platform.speech, "available").mockResolvedValue(true);
		const start = vi
			.spyOn(mounted.test.container.platform.speech, "start")
			.mockImplementation(async () => ok(undefined));
		await mountChat(mounted);

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));

		await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
	});

	it("COMP-09 the composer's Add snippet opens Create snippet and saves it", async () => {
		const mounted = await seed();
		await mountChat(mounted);
		const trigger = await screen.findByRole("button", {
			name: "Add attachments, link issues, and more",
		});
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: /Add snippet/ }));
		await screen.findByRole("dialog", { name: "Create snippet" });

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Review" } });
		fireEvent.change(screen.getByLabelText("Prompt snippet"), {
			target: { value: "Review this change." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(mounted.test.container.services.composer.store.getState().snippets).toEqual([
				expect.objectContaining({ name: "Review", prompt: "Review this change." }),
			]),
		);
	});
});
