/**
 * @feature RUN-06 Terminal tab body
 * Owns: tests for neighbour selection when a tab closes and for hidden tabs staying mounted.
 * Test first: closing the active terminal selects its neighbour and does not unmount the others.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../terminal/TerminalView.tsx", () => ({
	TerminalView: (props: { terminalId: string; visible: boolean }) => (
		<div data-testid={`view-${props.terminalId}`} data-visible={String(props.visible)} />
	),
}));

const { TerminalTabBody, nextTerminalAfterClose } = await import("./TerminalTabBody.tsx");

const id = (value: string) => value as TerminalId;
const workspaceId = "w1" as WorkspaceId;

afterEach(cleanup);

describe("RUN-06 terminal tab body", () => {
	it("selects the next terminal when the active one closes", () => {
		const ids = [id("a"), id("b"), id("c")];
		expect(nextTerminalAfterClose(ids, id("b"))).toBe("c");
		expect(nextTerminalAfterClose(ids, id("a"))).toBe("b");
	});

	it("selects the previous terminal when the last one closes", () => {
		expect(nextTerminalAfterClose([id("a"), id("b"), id("c")], id("c"))).toBe("b");
	});

	it("selects nothing when no terminal is left, and the first for an unknown id", () => {
		expect(nextTerminalAfterClose([id("a")], id("a"))).toBeNull();
		expect(nextTerminalAfterClose([id("a"), id("b")], id("gone"))).toBe("a");
	});

	it("keeps a hidden terminal mounted when another tab is shown", () => {
		const { rerender } = render(
			<TerminalTabBody
				workspaceId={workspaceId}
				terminalId={id("a")}
				visible={false}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("view-a").dataset.visible).toBe("false");
		rerender(
			<TerminalTabBody workspaceId={workspaceId} terminalId={id("a")} visible onClose={vi.fn()} />,
		);
		expect(screen.getByTestId("view-a").dataset.visible).toBe("true");
	});
});
