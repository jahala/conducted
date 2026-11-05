import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { AgentLoginDialog } from "./AgentLoginDialog.tsx";

const deviceFlow = {
	instructions: "Open the page and enter this code.",
	code: "ABCD-1234",
	verificationUrl: "https://example.com/device",
};

afterEach(cleanup);

describe("SET-03 AgentLoginDialog", () => {
	it("offers a copy button for the device code", () => {
		const onCopy = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				flow={deviceFlow}
				error={null}
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
				onCopy={onCopy}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

		expect(onCopy).toHaveBeenCalledWith("ABCD-1234");
	});

	it("opens the verification page for a device-code flow", () => {
		const onOpenUrl = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				flow={deviceFlow}
				error={null}
				onOpenUrl={onOpenUrl}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open browser" }));

		expect(onOpenUrl).toHaveBeenCalledWith("https://example.com/device");
	});

	it("closes itself when the install turns authenticated", async () => {
		const onOpenChange = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				flow={deviceFlow}
				error={null}
				signedIn
				onOpenUrl={vi.fn()}
				onOpenChange={onOpenChange}
				onRetry={vi.fn()}
			/>,
		);

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("shows the setup-token command and asks for the pasted code", () => {
		render(
			<AgentLoginDialog
				open
				agentName="Claude Code"
				flow={{
					instructions: "Run claude setup-token, then paste the code.",
					command: "claude setup-token",
				}}
				error={null}
				requiresCode
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
				onFinish={vi.fn()}
			/>,
		);

		expect(screen.getByText("claude setup-token")).toBeTruthy();
		expect(screen.getByLabelText("Paste code from Claude")).toBeTruthy();
	});

	it("passes the pasted code to the finish action", () => {
		const onFinish = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Claude Code"
				flow={{ instructions: "Paste the code.", command: "claude setup-token" }}
				error={null}
				requiresCode
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
				onFinish={onFinish}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Paste code from Claude"), {
			target: { value: "code-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));

		expect(onFinish).toHaveBeenCalledWith("code-123");
	});

	it("shows the failure and a Retry action when the flow did not start", () => {
		const onRetry = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="OpenCode"
				flow={null}
				error="OpenCode signs in with its own program."
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={onRetry}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toBe("OpenCode signs in with its own program.");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
