import type { SessionId } from "@conducted/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChatBlock } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { ChatBlockView } from "./ChatBlockView.tsx";

// seam: CHAT-24 mermaid needs real browser layout; its renderer is stood in for at the module edge.
vi.mock("mermaid", () => ({
	default: {
		initialize: vi.fn(),
		render: vi.fn(async () => ({
			svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>flow</text></svg>',
		})),
	},
}));

let test: ReturnType<typeof createTestContainer> | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("CHAT-24 assistant text reaches diagrams and video through the real container", () => {
	it("draws a mermaid fence and shows a video from the reply's Markdown", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/reply" });
		const block: ChatBlock = {
			kind: "text",
			text: "```mermaid\ngraph TD\nA --> B\n```\n\n![Clip](media/clip.mp4)",
		};
		render(
			<ServicesProvider container={test.container}>
				<ChatBlockView
					block={block}
					sessionId={"session-1" as SessionId}
					workspaceId={workspace.id}
				/>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Expand diagram" })).toBeTruthy();
		await waitFor(() => expect(screen.getByLabelText("Clip")).toBeTruthy());
	});
});
