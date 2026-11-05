/**
 * @feature REV-09 Turn change summary
 * Tests the list under a turn: five files then "and N more", the empty case, deleted, renamed and
 * binary rows, the reverted style, and the turn scope handed to Open diff.
 */
import type { FileChange } from "@conducted/protocol";
import type { TurnId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";
import { TurnChanges } from "./TurnChanges.tsx";

afterEach(cleanup);

const sessionId = "s1" as Parameters<typeof TurnChanges>[0]["sessionId"];

const change = (path: string, over: Partial<FileChange> = {}): FileChange => ({
	path,
	status: "modified",
	linesAdded: 2,
	linesRemoved: 1,
	binary: false,
	...over,
});

function turn(changes: FileChange[], over: Partial<ChatTurn> = {}): ChatTurn {
	return {
		turnId: "t1" as TurnId,
		startedBy: "user",
		userMessage: null,
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes,
		outcome: "success",
		error: null,
		startedAt: 10,
		endedAt: 20,
		usage: null,
		reverted: false,
		...over,
	};
}

describe("REV-09 turn changes", () => {
	it("shows the first five files and how many more there are", () => {
		const files = Array.from({ length: 12 }, (_, index) => change(`src/file-${index}.ts`));
		render(<TurnChanges turn={turn(files)} sessionId={sessionId} />);

		for (let index = 0; index < 5; index += 1) {
			expect(screen.getByText(`src/file-${index}.ts`)).toBeTruthy();
		}
		expect(screen.queryByText("src/file-5.ts")).toBeNull();
		expect(screen.getByText("and 7 more")).toBeTruthy();

		fireEvent.click(screen.getByText("and 7 more"));
		expect(screen.getByText("src/file-11.ts")).toBeTruthy();
		expect(screen.queryByText("and 7 more")).toBeNull();
	});

	it("renders nothing when the turn changed no files", () => {
		const { container } = render(<TurnChanges turn={turn([])} sessionId={sessionId} />);
		expect(container.firstChild).toBeNull();
	});

	it("names the old path of a rename, marks a deletion, and gives a binary file no counts", () => {
		render(
			<TurnChanges
				turn={turn([
					change("src/new.ts", { status: "renamed", oldPath: "src/old.ts" }),
					change("gone.ts", { status: "deleted", linesAdded: 0, linesRemoved: 9 }),
					change("image.png", { linesAdded: 0, linesRemoved: 0, binary: true }),
				])}
				sessionId={sessionId}
			/>,
		);

		expect(screen.getByText("Renamed")).toBeTruthy();
		expect(screen.getByText("from src/old.ts")).toBeTruthy();
		expect(screen.getByText("Deleted")).toBeTruthy();
		expect(screen.getByText("binary")).toBeTruthy();
		expect(screen.queryByText("+0")).toBeNull();
	});

	it("strikes through every row of a reverted turn", () => {
		const { container } = render(
			<TurnChanges turn={turn([change("a.ts")], { reverted: true })} sessionId={sessionId} />,
		);
		expect(container.querySelector("ul")?.className).toContain("line-through");
	});

	it("hands Open diff the turn scope", () => {
		const onOpenDiff = vi.fn();
		render(
			<TurnChanges turn={turn([change("a.ts")])} sessionId={sessionId} onOpenDiff={onOpenDiff} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open diff" }));
		expect(onOpenDiff).toHaveBeenCalledWith({ kind: "turn", sessionId, turnId: "t1" });
	});

	it("shows Open diff disabled when no caller can open the panel", () => {
		render(<TurnChanges turn={turn([change("a.ts")])} sessionId={sessionId} />);
		const button = screen.getByRole("button", { name: "Open diff" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});
});
