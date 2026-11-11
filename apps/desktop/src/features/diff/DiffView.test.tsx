/**
 * @feature REV-02 Diff view
 * Tests the warnings, the annotation slots, the dismissal rules, and a new comment written from the
 * gutter (REV-03). The renderer is a stand-in here; DiffView.renderer.test.tsx runs the real one.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../core/api.ts";

const renderer = vi.hoisted(() => ({
	failure: null as Error | null,
	/** The line the pointer is over, as the real renderer reports it to the gutter. */
	hovered: undefined as { lineNumber: number; side: "deletions" | "additions" } | undefined,
}));

vi.mock("@pierre/diffs/react", () => ({
	MultiFileDiff: ({
		oldFile,
		newFile,
		lineAnnotations,
		renderAnnotation,
		renderGutterUtility,
	}: {
		oldFile: { contents: string } | null;
		newFile: { contents: string } | null;
		lineAnnotations?: { side: string; lineNumber: number; metadata: unknown }[];
		renderAnnotation?: (annotation: unknown) => unknown;
		renderGutterUtility?: (
			getHoveredLine: () => { lineNumber: number; side: string } | undefined,
		) => unknown;
	}) => {
		if (renderer.failure !== null) throw renderer.failure;
		return (
			<div data-testid="multifile">
				<div data-testid="gutter">{renderGutterUtility?.(() => renderer.hovered) as ReactNode}</div>
				<span data-testid="old">{oldFile?.contents ?? ""}</span>
				<span data-testid="new">{newFile?.contents ?? ""}</span>
				{lineAnnotations?.map((annotation) => (
					<div
						key={`${annotation.side}:${annotation.lineNumber}`}
						data-side={annotation.side}
						data-line={annotation.lineNumber}
					>
						{renderAnnotation?.(annotation) as ReactNode}
					</div>
				))}
			</div>
		);
	},
	PatchDiff: ({ patch }: { patch: string }) => <div data-testid="patch">{patch}</div>,
}));

const { DiffView } = await import("./DiffView.tsx");

afterEach(() => {
	cleanup();
	renderer.failure = null;
	renderer.hovered = undefined;
	vi.restoreAllMocks();
});

const preferences = {
	layout: "unified" as const,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const fileDiff = (over: Partial<FileDiff> = {}): FileDiff => ({
	path: "src/a.ts",
	oldText: "one\ntwo\nthree\n",
	newText: "one\nTWO\nthree\n",
	patch: "",
	binary: false,
	tooLarge: false,
	...over,
});

const props = {
	preferences,
	forceRender: false,
	onForceRender: () => {},
};

describe("REV-02 DiffView", () => {
	it("places an annotation from the comment layer under its line", () => {
		render(
			<DiffView
				{...props}
				diff={fileDiff()}
				annotations={[
					{
						side: "additions",
						lineNumber: 3,
						metadata: { threadIds: ["t1"], commentIds: ["c1"] },
					},
				]}
				renderAnnotation={() => <div data-testid="thread">looks good</div>}
			/>,
		);
		expect(screen.getByTestId("old").textContent).toContain("one");
		expect(screen.getByTestId("new").textContent).toContain("TWO");
		const lineThree = document.querySelector('[data-side="additions"][data-line="3"]');
		expect(lineThree?.textContent).toContain("looks good");
	});

	it("REV-03: writes a new comment with a suggested change from the hovered line", async () => {
		const onAdd = vi.fn(async () => true);
		renderer.hovered = { lineNumber: 2, side: "additions" };
		render(
			<DiffView
				{...props}
				diff={fileDiff()}
				comments={[]}
				commentHandlers={{
					onAdd,
					onEdit: async () => true,
					onDelete: async () => true,
					onSetResolved: async () => true,
					onSendToChat: () => {},
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add a comment for the AI" }));
		const lineTwo = document.querySelector('[data-side="additions"][data-line="2"]');
		expect(lineTwo?.querySelector('[aria-label="Comment"]')).not.toBeNull();
		fireEvent.change(screen.getByRole("textbox", { name: "Add a comment for the AI" }), {
			target: { value: "Lower case, please" },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "Suggest a change" }));
		expect(
			(screen.getByRole("textbox", { name: "Suggested code" }) as HTMLTextAreaElement).value,
		).toBe("TWO");
		fireEvent.change(screen.getByRole("textbox", { name: "Suggested code" }), {
			target: { value: "two" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Comment" }));

		await waitFor(() =>
			expect(onAdd).toHaveBeenCalledWith(
				{ filePath: "src/a.ts", side: "additions", line: 2, endLine: null },
				"Lower case, please",
				{ side: "additions", suggestion: { code: "two", baseCode: "TWO" } },
			),
		);
		await waitFor(() => expect(document.querySelector('[aria-label="Comment"]')).toBeNull());
	});

	it("shows the binary warning and does not render a diff", () => {
		render(<DiffView {...props} diff={fileDiff({ oldText: null, newText: null, binary: true })} />);
		expect(screen.getByText("Binary file changed")).toBeTruthy();
		expect(screen.queryByTestId("multifile")).toBeNull();
	});

	it("holds back a large diff until the user asks for it", () => {
		const onForceRender = vi.fn();
		render(
			<DiffView
				{...props}
				onForceRender={onForceRender}
				diff={fileDiff({ oldText: null, newText: null, tooLarge: true })}
			/>,
		);
		expect(screen.getByText("This file is too large to show")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Render anyway" }));
		expect(onForceRender).toHaveBeenCalledTimes(1);
	});

	it("offers to show whitespace through the preference handler", () => {
		const onPreferencesChange = vi.fn();
		render(
			<DiffView
				{...props}
				preferences={{ ...preferences, hideWhitespaceChanges: true }}
				onPreferencesChange={onPreferencesChange}
				diff={fileDiff({ oldText: "a b\n", newText: "a  b\n" })}
			/>,
		);
		expect(screen.getByText("Only whitespace changes found")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show whitespace changes" }));
		expect(onPreferencesChange).toHaveBeenCalledWith({
			...preferences,
			hideWhitespaceChanges: false,
		});
	});

	it("keeps the current diff visible while an update is on the way", () => {
		render(<DiffView {...props} updating={true} diff={fileDiff()} />);
		expect(screen.getByText("Updating diff")).toBeTruthy();
		expect(screen.getByTestId("multifile")).toBeTruthy();
	});

	it("uses a patch when there are no file texts", () => {
		render(
			<DiffView
				{...props}
				diff={fileDiff({ oldText: null, newText: null, patch: "diff --git a/a b/a" })}
			/>,
		);
		expect(screen.getByTestId("patch").textContent).toContain("diff --git");
	});

	it("does not draw a too-large diff after its warning is dismissed", () => {
		render(<DiffView {...props} diff={fileDiff({ tooLarge: true })} />);
		expect(screen.queryByTestId("multifile")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss diff rendering warning" }));
		expect(screen.queryByText("This file is too large to show")).toBeNull();
		expect(screen.queryByTestId("multifile")).toBeNull();
	});

	it("does not draw a too-large diff while an update notice is showing", () => {
		render(<DiffView {...props} updating={true} diff={fileDiff({ tooLarge: true })} />);
		expect(screen.getByText("Updating diff")).toBeTruthy();
		expect(screen.queryByTestId("multifile")).toBeNull();
	});

	it("draws a too-large diff once the user asks for it", () => {
		render(<DiffView {...props} forceRender={true} diff={fileDiff({ tooLarge: true })} />);
		expect(screen.getByTestId("multifile")).toBeTruthy();
	});

	it("shows the failure card, not a blank panel, when the renderer throws", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderer.failure = new Error("renderer broke");
		render(<DiffView {...props} diff={fileDiff()} />);
		expect(screen.getByText("Failed to open editor")).toBeTruthy();
		renderer.failure = null;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(screen.getByTestId("multifile")).toBeTruthy();
	});

	it("draws an added file with one side empty", () => {
		render(<DiffView {...props} diff={fileDiff({ oldText: null })} />);
		expect(screen.getByTestId("new").textContent).toContain("TWO");
		expect(screen.getByTestId("old").textContent).toBe("");
	});

	it("keeps a dismissed warning hidden for the same file", () => {
		render(<DiffView {...props} diff={fileDiff({ oldText: null, newText: null, binary: true })} />);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss diff rendering warning" }));
		expect(screen.queryByText("Binary file changed")).toBeNull();
	});
});
