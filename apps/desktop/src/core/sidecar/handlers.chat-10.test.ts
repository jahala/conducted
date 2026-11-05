/**
 * Tests for CHAT-10: the sidecar's requestInteraction request reaches the interactions port.
 */
import type { InteractionAnswer, InteractionRequest } from "@conducted/protocol";
import { describe, expect, it, vi } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

describe("CHAT-10 requestInteraction handler", () => {
	it("passes the request to the interactions port and returns its answer", async () => {
		const answer: InteractionAnswer = { kind: "question", answers: [["SQLite"]] };
		const request = vi.fn(async () => answer);
		const handlers = createSidecarRequestHandlers({
			interactions: { request },
		} as unknown as SidecarHandlerPorts);
		const params: InteractionRequest = {
			sessionId: "s1" as InteractionRequest["sessionId"],
			interactionId: "i1" as InteractionRequest["interactionId"],
			interaction: {
				kind: "question",
				questions: [
					{ question: "Which database?", options: [{ label: "SQLite" }], multiSelect: false },
				],
			},
		};

		const result = await handlers.requestInteraction(params);

		expect(request).toHaveBeenCalledWith(params);
		expect(result).toEqual(answer);
	});
});
