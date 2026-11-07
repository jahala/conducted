/**
 * @feature NAV-10 Workspace layout
 * Owns: tests for the three-slot frame and the right panel toggle.
 * Test first: renders all three slots; toggleRightPanel hides and shows the right panel.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceLayout } from "./WorkspaceLayout.tsx";

afterEach(cleanup);

const renderLayout = () =>
	render(
		<WorkspaceLayout
			workspaceId={"w1" as WorkspaceId}
			header={(controls) => (
				<button
					type="button"
					aria-pressed={controls.rightPanelOpen}
					onClick={controls.toggleRightPanel}
				>
					Toggle right panel
				</button>
			)}
			content={<p>content</p>}
			gitPanel={<p>git</p>}
			scriptsPanel={<p>scripts</p>}
		/>,
	);

describe("NAV-10 WorkspaceLayout", () => {
	it("renders all three slots and the right panel", () => {
		renderLayout();
		for (const text of ["content", "git", "scripts"]) {
			expect(screen.getByText(text)).toBeTruthy();
		}
		expect(screen.getByRole("complementary", { name: "Changes and scripts" })).toBeTruthy();
	});

	it("hides and shows the right panel with the toggle", async () => {
		renderLayout();
		const toggle = screen.getByRole("button", { name: "Toggle right panel" });
		const aside = screen.getByRole("complementary", { name: "Changes and scripts" });
		fireEvent.click(toggle);
		await waitFor(() => expect(aside.getAttribute("data-right-panel-open")).toBe("false"));
		fireEvent.click(toggle);
		await waitFor(() => expect(aside.getAttribute("data-right-panel-open")).toBe("true"));
	});
});
