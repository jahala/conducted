/**
 * @feature NAV-11 Unread state
 * Owns: the test that a chat tab draws the shared unread dot, not its own copy.
 * Behaviour: ui-map.md 3.2 (chat tab: unread dot), 8 (the `unread` colour token).
 * Test first: an unread chat tab shows one dot in the unread colour.
 */
import type { SessionId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabItem } from "./TabItem.tsx";
import type { TabDescriptor } from "./tab-layout.ts";

afterEach(cleanup);

const tab: TabDescriptor = {
	kind: "session",
	ref: "session:one",
	title: "Fix login",
	sessionId: "one" as SessionId,
	unread: true,
};

describe("NAV-11 TabItem unread dot", () => {
	it("draws one dot in the unread colour", () => {
		render(<TabItem tab={tab} active={false} onSelect={vi.fn()} onClose={vi.fn()} />);
		const dots = screen.getAllByRole("img", { name: "Unread" });
		expect(dots).toHaveLength(1);
		expect(dots[0]?.className).toContain("bg-unread");
	});
});
