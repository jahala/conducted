/**
 * @feature RUN-03 Detected port row
 * Owns: tests for one listening port row and its open actions.
 * Test first: with the in-app browser setting off, only the system browser action shows.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectedPortRow } from "./DetectedPortRow.tsx";

afterEach(cleanup);

const props = {
	port: 3000,
	isWorkspacePort: false,
	inAppPreviewEnabled: false,
	onOpenInBrowser: () => {},
	onOpenInPreview: () => {},
	onCopyUrl: () => {},
};

describe("RUN-03 detected port row", () => {
	it("shows only the system browser action when in-app preview is off", () => {
		render(<DetectedPortRow {...props} />);

		expect(screen.getByRole("button", { name: /Open in browser/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Open in preview/ })).toBeNull();
	});

	it("also offers the in-app preview when the setting is on", () => {
		render(<DetectedPortRow {...props} inAppPreviewEnabled />);

		expect(screen.getByRole("button", { name: /Open in browser/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Open in preview/ })).toBeTruthy();
	});

	it("marks the workspace's own port", () => {
		render(<DetectedPortRow {...props} isWorkspacePort />);

		expect(screen.getByText("Workspace port")).toBeTruthy();
	});

	it("shows the process name and the macOS app that owns it", () => {
		render(
			<DetectedPortRow
				{...props}
				processName="node /code/workspace/server.js"
				appName="Google Chrome"
			/>,
		);

		expect(screen.getByText("Google Chrome (node /code/workspace/server.js)")).toBeTruthy();
	});

	it("offers to activate an app that owns the port", () => {
		const onActivateApp = vi.fn();
		render(<DetectedPortRow {...props} appName="My App" onActivateApp={onActivateApp} />);

		fireEvent.click(screen.getByRole("button", { name: /Activate My App/ }));

		expect(onActivateApp).toHaveBeenCalledTimes(1);
	});

	it("calls each action the user presses", () => {
		const onOpenInBrowser = vi.fn();
		const onOpenInPreview = vi.fn();
		const onCopyUrl = vi.fn();
		render(
			<DetectedPortRow
				{...props}
				inAppPreviewEnabled
				onOpenInBrowser={onOpenInBrowser}
				onOpenInPreview={onOpenInPreview}
				onCopyUrl={onCopyUrl}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Open in browser/ }));
		fireEvent.click(screen.getByRole("button", { name: /Open in preview/ }));
		fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));

		expect(onOpenInBrowser).toHaveBeenCalledTimes(1);
		expect(onOpenInPreview).toHaveBeenCalledTimes(1);
		expect(onCopyUrl).toHaveBeenCalledTimes(1);
	});
});
