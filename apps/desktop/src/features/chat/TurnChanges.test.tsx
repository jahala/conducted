/**
 * @feature REV-09 Turn change summary
 * Tests the file chips in a turn's footer: two files then "+N more" (Conductor's footer), the empty case,
 * deleted, renamed and binary files named in each chip's tooltip, the reverted style, and the turn scope
 * handed to Open diff and to a chip.
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
	it("shows the first two files and how many more there are, three more per click", () => {
		// Conductor shows up to three chips; with more files, two chips and "+N more".
		const files = Array.from({ length: 12 }, (_, index) => change(`src/file-${index}.ts`));
		render(<TurnChanges turn={turn(files)} sessionId={sessionId} />);

		for (let index = 0; index < 2; index += 1) {
			expect(screen.getByText(`file-${index}.ts`)).toBeTruthy();
		}
		expect(screen.queryByText("file-2.ts")).toBeNull();
		expect(screen.getByText("+10 more")).toBeTruthy();

		fireEvent.click(screen.getByText("+10 more"));
		expect(screen.getByText("file-4.ts")).toBeTruthy();
		expect(screen.queryByText("+10 more")).toBeNull();
		expect(screen.getByText("+7 more")).toBeTruthy();
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

		// The change kind moved from a text column into each chip's tooltip, as Conductor's chips carry no
		// status word.
		expect(screen.getByTitle("Renamed from src/old.ts: src/new.ts")).toBeTruthy();
		expect(screen.getByTitle("Renamed from src/old.ts: src/new.ts").textContent).toContain(
			"new.ts",
		);
		expect(screen.getByTitle("Deleted: gone.ts")).toBeTruthy();
		expect(screen.getByTitle("Modified: image.png (binary)")).toBeTruthy();
		expect(screen.getAllByText("+0").length).toBe(2);
	});

	it("strikes through every row of a reverted turn", () => {
		const { container } = render(
			<TurnChanges turn={turn([change("a.ts")], { reverted: true })} sessionId={sessionId} />,
		);
		expect(container.querySelector("section")?.className).toContain("line-through");
	});

	it("hands Open diff the turn scope", () => {
		const onOpenDiff = vi.fn();
		render(
			<TurnChanges turn={turn([change("a.ts")])} sessionId={sessionId} onOpenDiff={onOpenDiff} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open diff" }));
		expect(onOpenDiff).toHaveBeenCalledWith({ kind: "turn", sessionId, turnId: "t1" });
	});

	it("hands a chip the file and the turn scope", () => {
		const onOpenFile = vi.fn();
		render(
			<TurnChanges
				turn={turn([change("src/a.ts")])}
				sessionId={sessionId}
				onOpenFile={onOpenFile}
			/>,
		);
		fireEvent.click(screen.getByText("a.ts"));
		expect(onOpenFile).toHaveBeenCalledWith("src/a.ts", { kind: "turn", sessionId, turnId: "t1" });
	});

	it("shows Open diff disabled when no caller can open the panel", () => {
		render(<TurnChanges turn={turn([change("a.ts")])} sessionId={sessionId} />);
		const button = screen.getByRole("button", { name: "Open diff" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});
});
