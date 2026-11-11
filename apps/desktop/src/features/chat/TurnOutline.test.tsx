/**
 * @feature CHAT-25 Turn outline and jump list
 * Owns: tests of the turn outline's tick strip, jump list, plan and running marks, and its keyboard
 * close with focus returned to the trigger.
 * Behaviour: coverage/inventory-controls.md (a "Table of contents" button beside the message list),
 * ui-map.md 3.3 (chat list).
 * Test first: three turns give three ticks; picking the second calls onJumpToTurn with its id.
 */
import type { TurnId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";
import { TurnOutline } from "./TurnOutline.tsx";

function makeTurn(index: number, over: Partial<ChatTurn> = {}): ChatTurn {
	return {
		turnId: `t${index}` as TurnId,
		startedBy: "user",
		userMessage: {
			messageId: `m${index}` as never,
			text: `Message ${index}`,
			attachmentPaths: [],
			at: index,
			sender: null,
		},
		steers: [],
		blocks: [{ kind: "text", text: `Reply ${index}` }],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: index,
		endedAt: index + 1,
		usage: null,
		reverted: false,
		...over,
	};
}

function planTurn(index: number): ChatTurn {
	return makeTurn(index, {
		blocks: [
			{
				kind: "tool",
				call: {
					toolUseId: `u${index}` as never,
					item: {
						kind: "tool_call",
						toolUseId: `u${index}` as never,
						tool: "exit_plan_mode",
						rawName: "ExitPlanMode",
						input: {},
					},
					result: null,
					blocks: [],
				},
			},
		],
	});
}

function wrap(children: ReactNode) {
	return (
		<VirtuosoMockContext.Provider value={{ viewportHeight: 320, itemHeight: 40 }}>
			{children}
		</VirtuosoMockContext.Provider>
	);
}

const trigger = () => screen.getByRole("button", { name: "Table of contents" });

afterEach(() => {
	cleanup();
});

describe("CHAT-25 turn outline", () => {
	it("gives three turns three ticks", () => {
		render(
			wrap(
				<TurnOutline
					turns={[makeTurn(0), makeTurn(1), makeTurn(2)]}
					currentTurnId={null}
					onJumpToTurn={vi.fn()}
				/>,
			),
		);

		expect(screen.getAllByTestId("turn-outline-tick")).toHaveLength(3);
	});

	it("calls onJumpToTurn with the id of the second turn picked from the list", async () => {
		const onJumpToTurn = vi.fn();
		const turns = [makeTurn(0), makeTurn(1), makeTurn(2)];
		render(wrap(<TurnOutline turns={turns} currentTurnId={null} onJumpToTurn={onJumpToTurn} />));

		fireEvent.click(trigger());
		const second = await screen.findByRole("button", { name: "Message 1" });
		fireEvent.click(second);

		expect(onJumpToTurn).toHaveBeenCalledWith("t1");
		await waitFor(() => expect(screen.queryByRole("button", { name: "Message 1" })).toBeNull());
		expect(document.activeElement).toBe(trigger());
	});

	it("shows nothing for a chat with no turns or one turn", () => {
		const { container, rerender } = render(
			wrap(<TurnOutline turns={[]} currentTurnId={null} onJumpToTurn={vi.fn()} />),
		);
		expect(container.firstChild).toBeNull();
		expect(screen.queryByRole("button", { name: "Table of contents" })).toBeNull();

		rerender(
			wrap(<TurnOutline turns={[makeTurn(0)]} currentTurnId={null} onJumpToTurn={vi.fn()} />),
		);
		expect(screen.queryByRole("button", { name: "Table of contents" })).toBeNull();
	});

	it("highlights the current turn's tick", () => {
		const { container } = render(
			wrap(
				<TurnOutline
					turns={[makeTurn(0), makeTurn(1)]}
					currentTurnId={"t1" as TurnId}
					onJumpToTurn={vi.fn()}
				/>,
			),
		);

		const current = container.querySelector('[data-turn-id="t1"]');
		const other = container.querySelector('[data-turn-id="t0"]');
		expect(current?.className).toContain("bg-accent");
		expect(other?.className).not.toContain("bg-accent");
	});

	it("marks a turn that proposed a plan with a taller accent tick", () => {
		const { container } = render(
			wrap(
				<TurnOutline
					turns={[makeTurn(0), planTurn(1)]}
					currentTurnId={null}
					onJumpToTurn={vi.fn()}
				/>,
			),
		);

		const planned = container.querySelector('[data-turn-id="t1"]');
		expect(planned?.className).toContain("h-1.5");
		expect(planned?.className).toContain("bg-accent");
	});

	it("pulses the tick of a running turn", () => {
		const { container } = render(
			wrap(
				<TurnOutline
					turns={[makeTurn(0), makeTurn(1, { outcome: "running" })]}
					currentTurnId={null}
					onJumpToTurn={vi.fn()}
				/>,
			),
		);

		expect(container.querySelector('[data-turn-id="t1"]')?.className).toContain("animate-pulse");
	});

	it("groups the ticks of a very long chat to a short strip", () => {
		const turns = Array.from({ length: 2000 }, (_, index) => makeTurn(index));
		render(wrap(<TurnOutline turns={turns} currentTurnId={null} onJumpToTurn={vi.fn()} />));

		const ticks = screen.getAllByTestId("turn-outline-tick");
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.length).toBeLessThanOrEqual(24);
	});

	it("closes the list with Escape and returns focus to the button", async () => {
		render(
			wrap(
				<TurnOutline
					turns={[makeTurn(0), makeTurn(1)]}
					currentTurnId={null}
					onJumpToTurn={vi.fn()}
				/>,
			),
		);

		fireEvent.click(trigger());
		const item = await screen.findByRole("button", { name: "Message 1" });
		fireEvent.keyDown(item, { key: "Escape" });

		await waitFor(() => expect(screen.queryByRole("button", { name: "Message 1" })).toBeNull());
		expect(document.activeElement).toBe(trigger());
	});
});
