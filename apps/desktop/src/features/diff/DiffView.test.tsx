/**
 * @feature REV-02 Diff view
 * Tests the warnings, the annotation slots, and the dismissal rules. The renderer is a stand-in
 * here; DiffView.renderer.test.tsx runs the real one.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../core/api.ts";
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

const { DiffView } = await import("./DiffView.tsx");

afterEach(cleanup);

const preferences = {
	layout: "unified" as const,
	entireFile: false,
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

	it("keeps a dismissed warning hidden for the same file", () => {
		render(<DiffView {...props} diff={fileDiff({ oldText: null, newText: null, binary: true })} />);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss diff rendering warning" }));
		expect(screen.queryByText("Binary file changed")).toBeNull();
	});
});
