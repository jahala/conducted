/**
 * Tests for CHAT-10: the host picks the card that matches the interaction's kind.
 *
 * The approval and plan cards belong to CHAT-11 and CHAT-12 and are still placeholders, so this
 * test replaces them with sentinels to show the host's choice without depending on their build.
 */
import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";

vi.mock("./ToolApprovalCard.tsx", () => ({
	ToolApprovalCard: () => <div>tool approval card</div>,
}));
vi.mock("./PlanReviewBar.tsx", () => ({
	PlanReviewBar: () => <div>plan bar</div>,
}));

const { InteractionHost } = await import("./InteractionHost.tsx");

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

const show = (interaction: Interaction) =>
	render(
		<InteractionHost
			sessionId={sessionId}
			interactionId={interactionId}
			interaction={interaction}
		/>,
	);

afterEach(cleanup);

describe("CHAT-10 interaction host", () => {
	it("renders the approval card for a tool_approval interaction", () => {
		show({
			kind: "tool_approval",
			toolUseId: "tu1",
			toolName: "Bash",
			input: { command: "ls" },
		} as unknown as Interaction);

		expect(screen.getByText("tool approval card")).toBeTruthy();
	});

	it("renders the plan bar for a plan_approval interaction", () => {
		show({ kind: "plan_approval", plan: "Do the thing." });

		expect(screen.getByText("plan bar")).toBeTruthy();
	});
});
