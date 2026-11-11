import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
				agent="codex"
				flow={deviceFlow}
				error={null}
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
				onCopy={onCopy}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Copy Codex verification code" }));

		expect(onCopy).toHaveBeenCalledWith("ABCD-1234");
	});

	it("opens the verification page for a device-code flow", () => {
		const onOpenUrl = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				agent="codex"
				flow={deviceFlow}
				error={null}
				onOpenUrl={onOpenUrl}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open device authorization" }));

		expect(onOpenUrl).toHaveBeenCalledWith("https://example.com/device");
	});

	it("closes itself when the install turns authenticated", async () => {
		const onOpenChange = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				agent="codex"
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

		expect(screen.getAllByText("claude setup-token").length).toBeGreaterThan(0);
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
		fireEvent.click(screen.getByRole("button", { name: "Connect" }));

		expect(onFinish).toHaveBeenCalledWith("code-123");
	});

	it("offers Retry when a started flow fails or times out", () => {
		const onRetry = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				agent="codex"
				flow={deviceFlow}
				error="The sign-in timed out."
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={onRetry}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toBe("The sign-in timed out.");
		fireEvent.click(screen.getByRole("button", { name: "Restart device authorization" }));

		expect(onRetry).toHaveBeenCalledTimes(1);
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

	it("draws Conductor's Codex device-code steps and plan choice", () => {
		const onOpenUrl = vi.fn();
		render(
			<AgentLoginDialog
				open
				agentName="Codex"
				agent="codex"
				flow={deviceFlow}
				error={null}
				onOpenUrl={onOpenUrl}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);

		expect(screen.getByText("Authorize Conducted to use your ChatGPT subscription.")).toBeTruthy();
		expect(screen.getByText("Enable device code authorization for Codex.")).toBeTruthy();
		expect(screen.getByText("Enter this code when OpenAI asks for it:")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Business plan" }));
		fireEvent.click(screen.getByRole("button", { name: "Open ChatGPT admin settings" }));
		expect(onOpenUrl).toHaveBeenCalledWith(expect.stringContaining("chatgpt.com/admin"));
	});

	it("asks for the pasted Claude code with Conductor's placeholder", () => {
		render(
			<AgentLoginDialog
				open
				agentName="Claude Code"
				agent="claude"
				flow={{ instructions: "Paste the code." }}
				error={null}
				requiresCode
				onOpenUrl={vi.fn()}
				onOpenChange={vi.fn()}
				onRetry={vi.fn()}
			/>,
		);

		expect((screen.getByLabelText("Paste code from Claude") as HTMLInputElement).placeholder).toBe(
			"Paste here",
		);
	});
});
