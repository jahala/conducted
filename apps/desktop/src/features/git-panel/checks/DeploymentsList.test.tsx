import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentView } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { DeploymentsList } from "./DeploymentsList.tsx";

afterEach(cleanup);

const deployment = (
	environment: string,
	updatedAt: number,
	provider: DeploymentView["provider"] = "vercel",
): DeploymentView => ({
	environment,
	provider,
	state: "deployed",
	url: null,
	updatedAt,
});

describe("PR-04 deployments list", () => {
	it("renders three deployments newest first", () => {
		render(
			<DeploymentsList
				deployments={[
					deployment("middle", 200),
					deployment("oldest", 100),
					deployment("newest", 300),
				]}
				onOpenUrl={vi.fn()}
			/>,
		);
		const rows = screen.getAllByTestId("deployment-row").map((row) => row.textContent ?? "");
		expect(rows[0]).toContain("newest");
		expect(rows[1]).toContain("middle");
		expect(rows[2]).toContain("oldest");
	});

	it("shows the generic mark for an unknown provider", () => {
		render(
			<DeploymentsList deployments={[deployment("preview", 100, "other")]} onOpenUrl={vi.fn()} />,
		);
		expect(screen.getByLabelText("Other deployment provider")).toBeTruthy();
	});

	it("opens a deployment's URL", () => {
		const onOpenUrl = vi.fn();
		render(
			<DeploymentsList
				deployments={[{ ...deployment("preview", 100), url: "https://example.test" }]}
				onOpenUrl={onOpenUrl}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(onOpenUrl).toHaveBeenCalledWith("https://example.test");
	});

	it("renders nothing when there are no deployments", () => {
		const { container } = render(<DeploymentsList deployments={[]} onOpenUrl={vi.fn()} />);
		expect(container.textContent).toBe("");
	});
});
