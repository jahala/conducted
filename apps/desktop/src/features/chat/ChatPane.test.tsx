import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./MessageList.tsx", () => ({ MessageList: () => <div>list</div> }));
vi.mock("./ProgressTracker.tsx", () => ({ ProgressTracker: () => <div>progress</div> }));
vi.mock("../composer/QueueBox.tsx", () => ({ QueueBox: () => <div>queue</div> }));
vi.mock("../composer/Composer.tsx", () => ({ Composer: () => <div>composer</div> }));
vi.mock("./interactions/InteractionDock.tsx", () => ({
	InteractionDock: () => <div>dock</div>,
}));

const { ChatPane } = await import("./ChatPane.tsx");

afterEach(cleanup);

describe("CHAT-06 chat pane", () => {
	it("lays out the message list, dock, progress, queue and composer for a chat", () => {
		const { container } = render(
			<ChatPane workspaceId={"w1" as never} sessionId={"s1" as never} />,
		);
		for (const region of ["messages", "agent-request", "progress", "queue", "composer"]) {
			expect(container.querySelector(`[data-region="${region}"]`)).toBeTruthy();
		}
	});
});
