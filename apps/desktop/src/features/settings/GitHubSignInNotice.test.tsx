/**
 * @feature PR-01 GitHub access
 * Owns: tests that the global notice raises Conductor's toast for the auth method that failed.
 * Test first: an unauthorized `pat` sign-in answers the token title and its action.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { GitHubSignInNotice } from "./GitHubSignInNotice.tsx";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	navigate.mockReset();
	for (const test of containers.splice(0)) test.close();
});

function renderWith(authMethod: "cli" | "pat") {
	const test = createTestContainer();
	containers.push(test);
	test.container.services.github.store.setState((state) => ({
		...state,
		health: {
			status: "broken",
			reason: "unauthorized",
			authMethod,
			lastSuccessAtMs: null,
			lastFailureAtMs: 123,
		},
	}));
	const error = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
	render(
		<ServicesProvider container={test.container}>
			<GitHubSignInNotice />
		</ServicesProvider>,
	);
	return { error };
}

describe("PR-01 GitHub sign-in notice", () => {
	it("raises the token notice with Open account settings", async () => {
		const { error } = renderWith("pat");
		await waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				"GitHub token rejected",
				expect.objectContaining({
					description:
						"Your personal access token may be expired or revoked. Update it in Settings.",
					duration: Number.POSITIVE_INFINITY,
					action: expect.objectContaining({ label: "Open account settings" }),
				}),
			),
		);
		const options = error.mock.calls[0]?.[1] as unknown as { action: { onClick: () => void } };
		options.action.onClick();
		expect(navigate).toHaveBeenCalledWith({
			to: "/settings/user/$page",
			params: { page: "account" },
		});
	});

	it("raises the expired sign-in notice with Reconnect", async () => {
		const { error } = renderWith("cli");
		await waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				"GitHub sign-in expired",
				expect.objectContaining({
					description: "Reconnect GitHub in Settings to keep pushing changes.",
					action: expect.objectContaining({ label: "Reconnect" }),
				}),
			),
		);
	});
});
