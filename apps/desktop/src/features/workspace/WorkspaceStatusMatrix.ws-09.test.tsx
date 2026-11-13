/**
 * @feature WS-09 Workspace status as a pure function
 * Owns: tests of the matrix-style status mark the Experimental setting "Workspace status matrix for
 * local workspaces" draws.
 * Test first: a merged workspace draws the merged pattern, and a failing one the error pattern.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceStatus } from "../../core/model.ts";
import { WorkspaceStatusMatrix } from "./WorkspaceStatusMatrix.tsx";

afterEach(cleanup);

const draw = (status: WorkspaceStatus | null, unread = false) =>
	render(<WorkspaceStatusMatrix status={status} hasUnread={unread} />).container;

const testIds = (root: HTMLElement): string[] =>
	[...root.querySelectorAll("[data-testid]")].map(
		(element) => element.getAttribute("data-testid") ?? "",
	);

describe("WS-09 workspace status matrix", () => {
	it("draws the merged pattern over a merged workspace", () => {
		const root = draw({ kind: "git", label: "merged" });

		expect(testIds(root)).toContain("workspace-status-matrix-merged-pattern");
		expect(testIds(root)).not.toContain("workspace-status-matrix-error-pattern");
	});

	it("draws the error pattern for failing checks and for a failed workspace", () => {
		for (const status of [
			{ kind: "git", label: "checks_failing" },
			{ kind: "lifecycle", label: "failed" },
		] as const) {
			const root = draw(status);
			expect(testIds(root)).toContain("workspace-status-matrix-error-pattern");
			expect(testIds(root)).not.toContain("workspace-status-matrix-merged-pattern");
			cleanup();
		}
	});

	it("draws the sixteen squares, or only the border ones for an unstarted workspace", () => {
		const squares = (root: HTMLElement) =>
			(root.querySelector('[data-testid="workspace-status-matrix-base"]')?.getAttribute("d") ?? "")
				.split("M")
				.filter((part) => part !== "").length;

		expect(squares(draw({ kind: "git", label: "clean" }))).toBe(16);
		cleanup();
		expect(squares(draw({ kind: "lifecycle", label: "unstarted" }))).toBe(12);
	});

	it("animates while an agent works, and holds still otherwise", () => {
		const working = draw({ kind: "agent", label: "working" });
		expect(
			working.querySelector('[data-testid="workspace-status-matrix"]')?.getAttribute("data-motion"),
		).toBe("active");
		cleanup();
		const still = draw({ kind: "git", label: "pr_open" });
		expect(
			still.querySelector('[data-testid="workspace-status-matrix"]')?.getAttribute("data-motion"),
		).toBe("steady");
	});
});
