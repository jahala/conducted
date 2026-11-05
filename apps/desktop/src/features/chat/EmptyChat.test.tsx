import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyChat } from "./EmptyChat.tsx";

afterEach(cleanup);

describe("CHAT-06 empty chat", () => {
	it("invites the user and offers four starters", () => {
		render(<EmptyChat onPick={vi.fn()} />);
		expect(screen.getByText("No messages yet")).toBeTruthy();
		expect(screen.getAllByRole("button")).toHaveLength(4);
	});

	it("calls onPick with the starter's text", () => {
		const onPick = vi.fn();
		render(<EmptyChat onPick={onPick} />);
		fireEvent.click(screen.getByRole("button", { name: "Review recent PRs" }));
		expect(onPick).toHaveBeenCalledWith("Review recent PRs");
	});

	it("does not offer starters in an archived workspace", () => {
		render(<EmptyChat onPick={vi.fn()} archived />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});
});
