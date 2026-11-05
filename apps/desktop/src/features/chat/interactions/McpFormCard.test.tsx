/**
 * Tests for CHAT-11: the MCP form card renders a server's form and sends the values.
 */
import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import { appError, err, type InteractionId, ok, type SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { McpFormCard } from "./McpFormCard.tsx";

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

type McpForm = Extract<Interaction, { kind: "mcp_form" }>;
type McpFormAnswer = Extract<InteractionAnswer, { kind: "mcp_form" }>;

const requiredString: McpForm = {
	kind: "mcp_form",
	server: "files",
	message: "Tell the server what to make.",
	schema: {
		type: "object",
		properties: { name: { type: "string", title: "Name" } },
		required: ["name"],
	},
};

const mixedForm: McpForm = {
	kind: "mcp_form",
	server: "files",
	message: "Choose the details.",
	schema: {
		type: "object",
		properties: {
			count: { type: "number", title: "Count" },
			enabled: { type: "boolean", title: "Enabled" },
			mode: { type: "string", title: "Mode", enum: ["fast", "slow"] },
		},
		required: ["count"],
	},
};

const unknownForm: McpForm = {
	kind: "mcp_form",
	server: "files",
	message: "Pick the files.",
	schema: {
		type: "object",
		properties: { files: { type: "array", title: "Files" } },
		required: ["files"],
	},
};

let test: TestContainer;
let answer: ReturnType<typeof vi.fn>;

const renderCard = (form: McpForm = requiredString, expiresAt: number | null = null) =>
	render(
		<ServicesProvider container={test.container}>
			<McpFormCard
				sessionId={sessionId}
				interactionId={interactionId}
				request={form}
				expiresAt={expiresAt}
			/>
		</ServicesProvider>,
	);

const acceptButton = () => screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement;
const sent = () => answer.mock.calls[0]?.[2] as McpFormAnswer | undefined;

beforeEach(() => {
	test = createTestContainer();
	answer = vi.fn(async () => ok(undefined));
	test.container.actions.sessions.answer = answer as typeof test.container.actions.sessions.answer;
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("CHAT-11 MCP form card", () => {
	it("blocks Accept until a required string has text", async () => {
		renderCard();

		expect(acceptButton().disabled).toBe(true);
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Ada" },
		});
		expect(acceptButton().disabled).toBe(false);

		fireEvent.click(acceptButton());

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "mcp_form",
				action: "accept",
				content: { name: "Ada" },
			}),
		);
	});

	it("sends numbers and booleans as their JSON types and shows an enum choice", async () => {
		renderCard(mixedForm);

		expect(screen.getByRole("combobox", { name: "Mode" })).toBeTruthy();
		fireEvent.change(screen.getByRole("textbox", { name: "Count" }), {
			target: { value: "3" },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
		fireEvent.click(acceptButton());

		await waitFor(() =>
			expect(sent()).toEqual({
				kind: "mcp_form",
				action: "accept",
				content: { count: 3, enabled: true },
			}),
		);
	});

	it("shows a message under an invalid number and blocks Accept", () => {
		renderCard(mixedForm);

		fireEvent.change(screen.getByRole("textbox", { name: "Count" }), {
			target: { value: "not a number" },
		});

		expect(screen.getByText("Enter a number.")).toBeTruthy();
		expect(acceptButton().disabled).toBe(true);
	});

	it("offers only Decline when the schema cannot be rendered", async () => {
		renderCard(unknownForm);

		expect(screen.getByText(/kind of field this app cannot show/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Decline" }));

		await waitFor(() => expect(sent()?.action).toBe("decline"));
	});

	it("maps Decline and Cancel to their protocol actions", async () => {
		const { unmount } = renderCard();
		fireEvent.click(screen.getByRole("button", { name: "Decline" }));
		await waitFor(() => expect(sent()?.action).toBe("decline"));

		unmount();
		answer.mockClear();
		renderCard();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(sent()?.action).toBe("cancel"));
	});

	it("shows that the request timed out and takes no answer", async () => {
		renderCard(requiredString, Date.now() - 1_000);

		expect(await screen.findByText(/timed out/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
		expect(answer).not.toHaveBeenCalled();
	});

	it("shows what was chosen after the answer", async () => {
		renderCard();

		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Ada" },
		});
		fireEvent.click(acceptButton());

		expect(await screen.findByText("Accepted")).toBeTruthy();
	});

	it("comes back with a retry message when the answer cannot be sent", async () => {
		answer
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));
		renderCard();

		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Ada" },
		});
		fireEvent.click(acceptButton());

		expect(await screen.findByText("Could not send the answer. Try again.")).toBeTruthy();
		fireEvent.click(acceptButton());
		await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
	});
});
