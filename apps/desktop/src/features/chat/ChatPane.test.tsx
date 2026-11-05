import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer } from "../../test/container.ts";

vi.mock("./MessageList.tsx", () => ({ MessageList: () => <div>list</div> }));
vi.mock("./ProgressTracker.tsx", () => ({ ProgressTracker: () => <div>progress</div> }));
vi.mock("../composer/QueueBox.tsx", () => ({ QueueBox: () => <div>queue</div> }));
vi.mock("../composer/Composer.tsx", () => ({ Composer: () => <div>composer</div> }));
vi.mock("./interactions/InteractionDock.tsx", () => ({
	InteractionDock: () => <div>dock</div>,
}));
vi.mock("./NextUnreadButton.tsx", () => ({ NextUnreadButton: () => null }));

const { ChatPane } = await import("./ChatPane.tsx");

afterEach(cleanup);

describe("CHAT-06 chat pane", () => {
	it("lays out the message list, dock, progress, queue and composer for a chat", async () => {
		const test = createTestContainer();
		try {
			const { container } = render(
				<ServicesProvider container={test.container}>
					<ChatPane workspaceId={"w1" as never} sessionId={"s1" as never} />
				</ServicesProvider>,
			);
			for (const region of ["messages", "agent-request", "progress", "queue", "composer"]) {
				expect(container.querySelector(`[data-region="${region}"]`)).toBeTruthy();
			}
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
