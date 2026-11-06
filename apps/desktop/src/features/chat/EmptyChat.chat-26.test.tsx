/**
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the empty chat's context shelves over the real container: the workspace line, earlier
 * chats, plans, attaching a transcript or a plan, and the failure toasts.
 * Behaviour: inventory label #340-341 and inventory:toast rows 756 to 758.
 * Test first: an empty chat lists "Add chat transcripts:" and "Add plans:" and attaching a chat
 * puts its transcript file in the draft.
 */
import { appError, err, type Result, type ToolUseId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { agentEvent, sampleSession, userMessageEvent } from "../../core/db/test-fixtures.ts";
import { createTestContainer, seedSessionEvent, seedWorkspace } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { EmptyChat } from "./EmptyChat.tsx";

const opened: ReturnType<typeof createTestContainer>[] = [];

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	for (const test of opened.splice(0)) test.close();
});

const testWith = (test: ReturnType<typeof createTestContainer>, child: ReactNode) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>
				{child}
				<Toaster />
			</ServicesProvider>
		</QueryClientProvider>,
	);
};

const setup = async () => {
	const test = createTestContainer();
	opened.push(test);
	const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/login" });
	const current = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	const earlier = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	must(await test.container.services.sessions.rename(earlier.id, "Login fix"));
	await seedSessionEvent(
		test.container,
		earlier.id,
		userMessageEvent("u1", "t1", 10),
		10,
	);
	return { test, workspace, current, earlier };
};

describe("CHAT-26 empty chat context shelves", () => {
	it("names the workspace and offers the transcript and plan shelves", async () => {
		const { test, workspace, current } = await setup();

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		expect(await screen.findByText("New chat in /code/workspaces/login.")).toBeTruthy();
		expect(screen.getByText("Add chat transcripts:")).toBeTruthy();
		expect(screen.getByText("Add plans:")).toBeTruthy();
		expect(await screen.findByRole("button", { name: "Login fix" })).toBeTruthy();
	});

	it("attaches an earlier chat's transcript to the draft", async () => {
		const { test, workspace, current, earlier } = await setup();

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Login fix" }));

		await waitFor(() =>
			expect(test.container.services.composer.draftOf(current.id).attachmentPaths).toHaveLength(1),
		);
		const path = test.container.services.composer.draftOf(current.id).attachmentPaths[0] ?? "";
		expect(path.endsWith(`Transcript of Login fix.md`)).toBe(true);
		expect(path).not.toContain(earlier.id);
	});

	it("shows No messages in this chat when the earlier chat is empty", async () => {
		const { test, workspace, current } = await setup();
		const empty = must(
			await test.container.services.sessions.create(workspace.id, sampleSession.config),
		);
		must(await test.container.services.sessions.rename(empty.id, "Empty chat"));

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Empty chat" }));

		expect(await screen.findByText("No messages in this chat")).toBeTruthy();
	});

	it("lists a plan an agent proposed and attaches it to the draft", async () => {
		const { test, workspace, current, earlier } = await setup();
		await seedSessionEvent(
			test.container,
			earlier.id,
			agentEvent("a1", "t1", 12, [
				{
					kind: "tool_call",
					toolUseId: "tool-1" as ToolUseId,
					tool: "exit_plan_mode",
					rawName: "ExitPlanMode",
					input: { plan: "# Fix the parser\n\nChange it, then test it." },
				},
			]),
			12,
		);

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Fix the parser" }));

		await waitFor(() =>
			expect(test.container.services.composer.draftOf(current.id).attachmentPaths).toHaveLength(1),
		);
		const path = test.container.services.composer.draftOf(current.id).attachmentPaths[0] ?? "";
		expect(path.endsWith("Plan - Fix the parser.md")).toBe(true);
	});

	it("shows Failed to attach plan when the plan cannot be saved", async () => {
		const { test, workspace, current, earlier } = await setup();
		await seedSessionEvent(
			test.container,
			earlier.id,
			agentEvent("a1", "t1", 12, [
				{
					kind: "tool_call",
					toolUseId: "tool-1" as ToolUseId,
					tool: "exit_plan_mode",
					rawName: "ExitPlanMode",
					input: { plan: "# Fix the parser\n\nChange it, then test it." },
				},
			]),
			12,
		);
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")) as Result<never>,
		);

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Fix the parser" }));

		expect(await screen.findByText("Failed to attach plan")).toBeTruthy();
	});

	it("shows Failed to attach chat transcript when the transcript cannot be saved", async () => {
		const { test, workspace, current } = await setup();
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")) as Result<never>,
		);

		testWith(
			test,
			<EmptyChat sessionId={current.id} workspaceId={workspace.id} directory={workspace.path} onPick={vi.fn()} />,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Login fix" }));

		expect(await screen.findByText("Failed to attach chat transcript")).toBeTruthy();
	});
});
