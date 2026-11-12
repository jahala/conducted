// @vitest-environment node
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { sampleSession } from "../db/test-fixtures.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Session } from "../model.ts";
import { ReviewService, type ReviewServiceDeps } from "./review.ts";
import type { AgentMessenger } from "./sessions.ts";

const session = sampleSession as Session;

function harness(overrides: Partial<ReviewServiceDeps> = {}): {
	service: ReviewService;
	startReviewChat: ReturnType<typeof vi.fn>;
	texts: string[];
} {
	const texts: string[] = [];
	const startReviewChat = vi.fn(async (_workspaceId: string, text: string) => {
		texts.push(text);
		return ok(session);
	});
	const deps: ReviewServiceDeps = {
		repos: {} as ReviewServiceDeps["repos"],
		git: {} as GitRunner,
		agent: {} as AgentMessenger,
		fs: {
			mkdirp: async () => ok(undefined),
			writeTextAtomic: async () => ok(undefined),
			exists: async () => ok(false),
		},
		workspacePathOf: async () => ok("/code/workspaces/test"),
		customPromptOf: async () => ok(null),
		startReviewChat,
		...overrides,
	};
	return { service: new ReviewService(deps), startReviewChat, texts };
}

describe("REV-05 requestAiReview", () => {
	it("starts a new chat with the default review text", async () => {
		const h = harness();

		const result = await h.service.requestAiReview(session.workspaceId, null);

		expect(result).toEqual(ok(session));
		expect(h.startReviewChat).toHaveBeenCalledWith(
			session.workspaceId,
			expect.stringContaining("Do not edit any files"),
		);
	});

	it("uses the repository's custom prompt instead of the default text", async () => {
		const h = harness({
			customPromptOf: async () => ok("Review only the database migrations."),
		});

		await h.service.requestAiReview(session.workspaceId, null);

		expect(h.texts).toEqual(["Review only the database migrations."]);
	});

	it("adds the extra instructions from the dialog after the chosen base", async () => {
		const h = harness({
			customPromptOf: async () => ok("Review only the database migrations."),
		});

		await h.service.requestAiReview(session.workspaceId, "  Check the indexes.  ");

		expect(h.texts[0]).toContain("Review only the database migrations.");
		expect(h.texts[0]).toContain("Check the indexes.");
	});

	it("returns the custom prompt error without starting a chat", async () => {
		const failure = appError("settings_file_invalid", "The repository settings are invalid.");
		const h = harness({ customPromptOf: async () => err(failure) });

		const result = await h.service.requestAiReview(session.workspaceId, null);

		expect(result).toEqual(err(failure));
		expect(h.startReviewChat).not.toHaveBeenCalled();
	});

	it("returns the chat error from the session service", async () => {
		const failure = appError("sidecar_unavailable", "The agent cannot start now.");
		const h = harness({ startReviewChat: async () => err(failure) });

		const result = await h.service.requestAiReview(session.workspaceId, null);

		expect(result).toEqual(err(failure));
	});
});
