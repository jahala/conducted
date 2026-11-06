import type { CommentId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffComment } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { PrCommentsList } from "./PrCommentsList.tsx";

afterEach(cleanup);

const comment = (id: string, body: string, over: Partial<DiffComment> = {}): DiffComment => ({
	id: id as CommentId,
	workspaceId: "w1" as DiffComment["workspaceId"],
	filePath: "src/app.ts",
	line: 4,
	endLine: null,
	body,
	author: { kind: "github", name: "ada", avatarUrl: null },
	state: "pending",
	side: "additions",
	threadId: id,
	replyToId: null,
	suggestion: null,
	remoteUrl: `https://github.com/o/r/pull/1#${id}`,
	resolved: false,
	outdated: false,
	createdAt: 0,
	updatedAt: 0,
	...over,
});

function renderList(comments: DiffComment[]) {
	render(
		<PrCommentsList
			comments={comments}
			onAddToChat={vi.fn()}
			onResolve={vi.fn()}
			onHide={vi.fn()}
			onOpenComment={vi.fn()}
		/>,
	);
}

describe("PR-04 PR comments", () => {
	it("hides a resolved comment until Show resolved is pressed", () => {
		renderList([
			comment("open", "still open"),
			comment("done", "already resolved", { resolved: true }),
		]);
		expect(screen.getByText("still open")).toBeTruthy();
		expect(screen.queryByText("already resolved")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Show resolved/ }));
		expect(screen.getByText("already resolved")).toBeTruthy();
	});

	it("groups a reply under its thread", () => {
		renderList([
			comment("root", "root body"),
			comment("reply", "reply body", { replyToId: "root" as CommentId }),
		]);
		expect(screen.getByText("root body")).toBeTruthy();
		expect(screen.getByText("reply body")).toBeTruthy();
	});

	it("resolves a thread and hides a comment from its own buttons", () => {
		const onResolve = vi.fn();
		const onHide = vi.fn();
		render(
			<PrCommentsList
				comments={[comment("open", "still open")]}
				onAddToChat={vi.fn()}
				onResolve={onResolve}
				onHide={onHide}
				onOpenComment={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
		expect(onResolve).toHaveBeenCalledWith("open", true);
		fireEvent.click(screen.getByRole("button", { name: "Hide" }));
		expect(onHide).toHaveBeenCalledWith("open");
	});

	it("says when there are no GitHub comments", () => {
		renderList([]);
		expect(screen.getByText("No review comments from GitHub.")).toBeTruthy();
	});

	it("offers no Hide when the caller cannot hide a comment", () => {
		render(
			<PrCommentsList
				comments={[comment("open", "still open")]}
				onAddToChat={vi.fn()}
				onResolve={vi.fn()}
				onOpenComment={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
	});
});
