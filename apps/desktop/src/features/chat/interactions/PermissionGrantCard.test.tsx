/**
 * Tests for CHAT-11: the Codex permission grant card asks for extra access and sends the answer.
 */
import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import {
	appError,
	type Clock,
	err,
	type InteractionId,
	ok,
	type SessionId,
} from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { PermissionGrantCard } from "./PermissionGrantCard.tsx";

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

type PermissionGrant = Extract<Interaction, { kind: "permission_grant" }>;
type PermissionGrantAnswer = Extract<InteractionAnswer, { kind: "permission_grant" }>;

const request = (changes: Partial<PermissionGrant> = {}): PermissionGrant => ({
	kind: "permission_grant",
	description: "Codex wants to read the project and use the network.",
	reason: "The test suite needs both.",
	paths: [{ path: "/code/project", pathKind: "path", access: "read" }],
	network: false,
	...changes,
});

let test: TestContainer;
let answer: ReturnType<typeof vi.fn>;

const renderCard = (
	changes: Partial<PermissionGrant> = {},
	expiresAt: number | null = null,
	clock?: Clock,
) =>
	render(
		<ServicesProvider container={test.container}>
			<PermissionGrantCard
				sessionId={sessionId}
				interactionId={interactionId}
				request={request(changes)}
				expiresAt={expiresAt}
				clock={clock}
			/>
		</ServicesProvider>,
	);

const sent = () => answer.mock.calls[0]?.[2] as PermissionGrantAnswer | undefined;

beforeEach(() => {
	test = createTestContainer();
	answer = vi.fn(async () => ok(undefined));
	test.container.actions.sessions.answer = answer as typeof test.container.actions.sessions.answer;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	test.close();
});

describe("CHAT-11 permission grant card", () => {
	it("approves for this turn when Approve is clicked", async () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "permission_grant",
				granted: true,
				grantFor: "turn",
			}),
		);
	});

	it("approves for the session when the session button is clicked", async () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Approve for this session" }));

		await waitFor(() => {
			expect(sent()).toEqual({
				kind: "permission_grant",
				granted: true,
				grantFor: "session",
			});
		});
	});

	it("denies the request", async () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Deny" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "permission_grant",
				granted: false,
			}),
		);
	});

	it("shows the reason, each requested path and a Network access card", () => {
		renderCard({
			network: true,
			paths: [
				{ path: "/code/project", pathKind: "path", access: "read" },
				{ path: "/code/project/out", pathKind: "path", access: "write" },
			],
		});

		expect(screen.getByText("The test suite needs both.")).toBeTruthy();
		expect(screen.getByText("/code/project")).toBeTruthy();
		expect(screen.getByText("/code/project/out")).toBeTruthy();
		expect(screen.getByText("Read")).toBeTruthy();
		expect(screen.getByText("Write")).toBeTruthy();
		const network = screen.getByRole("region", { name: "Network access" });
		expect(within(network).getByRole("button", { name: "Approve" })).toBeTruthy();
		expect(within(network).getByRole("button", { name: "Deny" })).toBeTruthy();
	});

	it("approves from the Network access card", async () => {
		renderCard({ network: true, paths: [] });

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "permission_grant",
				granted: true,
				grantFor: "turn",
			}),
		);
	});

	it("shows that the request timed out and takes no answer", async () => {
		renderCard({}, Date.now() - 1_000);

		expect(await screen.findByText(/timed out/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
		expect(answer).not.toHaveBeenCalled();
	});

	it("shows that it timed out when the clock passes the expiry while the card is open", () => {
		vi.useFakeTimers();
		let now = 1_000;
		const clock: Clock = { now: () => now };
		renderCard({}, 5_000, clock);

		expect(screen.queryByText(/timed out/)).toBeNull();
		act(() => {
			now = 5_000;
			vi.advanceTimersByTime(4_000);
		});

		expect(screen.getByText(/timed out/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
	});

	it("sends one answer when Approve is double clicked", async () => {
		renderCard();
		const approve = screen.getByRole("button", { name: "Approve" });

		fireEvent.click(approve);
		fireEvent.click(approve);

		await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(answer).toHaveBeenCalledTimes(1);
	});

	it("shows what was granted after the answer", async () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		expect(await screen.findByText("Approved for this turn")).toBeTruthy();
	});

	it("comes back with a retry message when the answer cannot be sent", async () => {
		answer
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		expect(
			await screen.findByText(/Could not send the answer: The sidecar is not running\./),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
	});
});
