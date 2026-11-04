import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedComposerBar } from "./ArchivedComposerBar.tsx";

afterEach(cleanup);

describe("ArchivedComposerBar", () => {
	it("says the workspace is archived and offers to unarchive it", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedComposerBar onUnarchive={onUnarchive} busy={false} />);
		expect(screen.getByText("This workspace is archived.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(onUnarchive).toHaveBeenCalledTimes(1);
	});
});
