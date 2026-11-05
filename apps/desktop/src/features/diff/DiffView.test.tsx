/**
 * @feature REV-02 Diff view
 * Tests the renderer choice, warnings, and placing comment threads at their lines.
 * REV-03's comment components and annotation mapping are stand-ins here; their own tests cover them.
 */
import type { CommentId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../core/api.ts";
import type { DiffComment } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

vi.mock("@pierre/diffs/react", () => ({
	MultiFileDiff: ({
		oldFile,
		newFile,
		lineAnnotations,
		renderAnnotation,
	}: {
		oldFile: { contents: string } | null;
		newFile: { contents: string } | null;
		lineAnnotations?: { side: string; lineNumber: number; metadata: unknown }[];
		renderAnnotation?: (annotation: unknown) => unknown;
	}) => (
		<div data-testid="multifile">
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
	),
	PatchDiff: ({ patch }: { patch: string }) => <div data-testid="patch">{patch}</div>,
}));

vi.mock("./diff-annotations.ts", () => ({
	commentsToAnnotations: (comments: readonly DiffComment[]) =>
		comments.map((comment) => ({
			side: comment.side,
			lineNumber: comment.line ?? 0,
			metadata: { threadIds: [comment.threadId ?? comment.id], commentIds: [comment.id] },
		})),
}));

vi.mock("./CommentThread.tsx", () => ({
	CommentThread: ({ comments }: { comments: DiffComment[] }) => (
		<div data-testid="thread">{comments.map((comment) => comment.body).join(",")}</div>
	),
}));

vi.mock("./CommentComposer.tsx", () => ({
	CommentComposer: () => <div data-testid="composer">Composer</div>,
}));

vi.mock("./GutterCommentButton.tsx", () => ({
	GutterCommentButton: () => <button type="button">Add a comment</button>,
}));

const { DiffView } = await import("./DiffView.tsx");

afterEach(cleanup);

const preferences = {
	layout: "unified" as const,
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const handlers = {
	onAdd: async () => true,
	onEdit: async () => true,
	onDelete: async () => true,
	onSetResolved: async () => true,
	onSendToChat: () => {},
};

const comment = (over: Partial<DiffComment> = {}): DiffComment => ({
	id: "c1" as CommentId,
	workspaceId: "ws-1" as DiffComment["workspaceId"],
	filePath: "src/a.ts",
	line: 3,
	endLine: 3,
	body: "looks good",
	author: { kind: "user", name: null, avatarUrl: null },
	state: "draft",
	side: "additions",
	threadId: null,
	replyToId: null,
	suggestion: null,
	remoteUrl: null,
	resolved: false,
	outdated: false,
	createdAt: 1,
	updatedAt: 1,
	...over,
});

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
	handlers,
	composerTarget: null,
	onComposerTargetChange: () => {},
	focusCommentId: null,
	forceRender: false,
	onForceRender: () => {},
};

describe("REV-02 DiffView", () => {
	it("renders a comment on additions line 3 under that line", () => {
		render(<DiffView {...props} diff={fileDiff()} comments={[comment()]} />);
		expect(screen.getByTestId("old").textContent).toContain("one");
		expect(screen.getByTestId("new").textContent).toContain("TWO");
		const lineThree = document.querySelector('[data-side="additions"][data-line="3"]');
		expect(lineThree?.textContent).toContain("looks good");
	});

	it("shows the binary warning and does not render a diff", () => {
		render(
			<DiffView
				{...props}
				diff={fileDiff({ oldText: null, newText: null, binary: true })}
				comments={[]}
			/>,
		);
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
				comments={[]}
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
				comments={[]}
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
		render(<DiffView {...props} updating={true} diff={fileDiff()} comments={[]} />);
		expect(screen.getByText("Updating diff")).toBeTruthy();
		expect(screen.getByTestId("multifile")).toBeTruthy();
	});

	it("uses a patch when there are no file texts", () => {
		render(
			<DiffView
				{...props}
				diff={fileDiff({ oldText: null, newText: null, patch: "diff --git a/a b/a" })}
				comments={[]}
			/>,
		);
		expect(screen.getByTestId("patch").textContent).toContain("diff --git");
	});

	it("keeps a dismissed warning hidden for the same file", () => {
		render(
			<DiffView
				{...props}
				diff={fileDiff({ oldText: null, newText: null, binary: true })}
				comments={[]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss diff rendering warning" }));
		expect(screen.queryByText("Binary file changed")).toBeNull();
	});
});
