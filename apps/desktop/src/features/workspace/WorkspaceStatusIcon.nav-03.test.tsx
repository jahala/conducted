import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStatusIcon } from "./WorkspaceStatusIcon.tsx";

afterEach(cleanup);

describe("NAV-03 WorkspaceStatusIcon", () => {
	it("announces active work with a status role", () => {
		render(<WorkspaceStatusIcon status={{ kind: "agent", label: "working" }} />);
		expect(screen.getByRole("status", { name: "Working…" })).toBeTruthy();
	});

	it("hides the spinner from screen readers when the status text sits beside it", () => {
		const { container } = render(
			<WorkspaceStatusIcon status={{ kind: "agent", label: "working" }} decorative />,
		);
		expect(screen.queryByRole("status")).toBeNull();
		expect(container.querySelector("[aria-hidden=true] [data-kind]")).not.toBeNull();
	});

	it("keeps the mark decorative when the status is settled or unknown", () => {
		const settled = render(<WorkspaceStatusIcon status={{ kind: "git", label: "clean" }} />);
		expect(settled.container.querySelector("[aria-hidden=true]")).not.toBeNull();
		settled.unmount();
		const unknown = render(<WorkspaceStatusIcon status={null} />);
		expect(unknown.container.querySelector("[aria-hidden=true]")).not.toBeNull();
	});

	it("draws Conductor's mark for each settled status, never a dot", () => {
		const cases = [
			[{ kind: "agent", label: "needs_permission" }, "alert", "text-fg-muted"],
			[{ kind: "agent", label: "needs_plan_review" }, "plan", "text-fg-muted"],
			[{ kind: "agent", label: "needs_answer" }, "question", "text-fg-muted"],
			[{ kind: "git", label: "checks_failing" }, "checks-failing", "text-danger"],
			[{ kind: "lifecycle", label: "failed" }, "alert", "text-danger"],
			[{ kind: "git", label: "ready_to_merge" }, "pull-request", "text-success"],
			[{ kind: "git", label: "merged" }, "merged", "text-merged"],
			[{ kind: "git", label: "clean" }, "branch", "text-fg-subtle"],
		] as const;
		for (const [status, mark, colour] of cases) {
			const view = render(<WorkspaceStatusIcon status={status} />);
			const drawn = view.container.querySelector(`[data-mark="${mark}"]`);
			expect(drawn, `${status.label} draws ${mark}`).not.toBeNull();
			expect(drawn?.className, `${status.label} is ${colour}`).toContain(colour);
			expect(view.container.querySelector(".rounded-full")).toBeNull();
			view.unmount();
		}
	});
});
