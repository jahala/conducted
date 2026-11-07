import type { ModelInfo } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { DefaultModelsPage } from "./DefaultModelsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

const model = (
	id: string,
	label: string,
	supportsFastMode: boolean,
	isDefault = false,
): ModelInfo => ({
	id,
	label,
	status: "picker",
	isNew: false,
	isDefault,
	efforts: ["low", "medium", "high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode,
	contextWindowTokens: 200_000,
});

describe("SET-02 DefaultModelsPage", () => {
	it("disables fast mode when the chosen model does not support it", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		test.container.services.agentCatalog.store.setState((state) => ({
			...state,
			installs: {
				state: "ready",
				data: [{ agent: "claude", installed: true, authenticated: true }],
			},
			models: {
				claude: {
					state: "ready",
					data: [
						model("fast-model", "Fast model", true, true),
						model("slow-model", "Slow model", false),
					],
				},
			},
		}));
		render(
			<ServicesProvider container={test.container}>
				<DefaultModelsPage />
			</ServicesProvider>,
		);

		const trigger = screen.getByRole("combobox", { name: "Default model" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		const slow = await screen.findByRole("option", { name: "Slow model" });
		fireEvent.keyDown(slow, { key: "Enter" });

		await waitFor(() =>
			expect(
				(screen.getByRole("switch", { name: "Fast mode in new chats" }) as HTMLButtonElement)
					.disabled,
			).toBe(true),
		);
		expect(screen.getByText("The chosen model does not support fast mode.")).toBeTruthy();
	});
});
