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

	it("marks attention with the accent dot and failure with the alert", () => {
		const attention = render(
			<WorkspaceStatusIcon status={{ kind: "agent", label: "needs_permission" }} />,
		);
		expect(attention.container.querySelector(".bg-accent")).not.toBeNull();
		attention.unmount();
		const danger = render(
			<WorkspaceStatusIcon status={{ kind: "git", label: "checks_failing" }} />,
		);
		expect(danger.getByText("!")).toBeTruthy();
	});
});
