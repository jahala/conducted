/**
 * @feature WS-08 Open-in menu item
 * Owns: tests for one app row: choosing it opens the app, and its secondary action makes it the
 * default.
 * Behaviour: ui-map.md 3.10.
 * Test first: choosing the item calls onOpen with the app, and "Set as default" calls onSetDefault.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { Menu, MenuContent, MenuTrigger } from "../../ui/Menu.tsx";
import { OpenInItem } from "./OpenInItem.tsx";
import type { OpenInApp } from "./open-in-apps.ts";

const cursor: OpenInApp = { appName: "Cursor", label: "Cursor", category: "editor" };

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

/** The real container around the control, which reads each app's icon through it. */
function providers() {
	const mounted = createTestContainer();
	test = mounted;
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={mounted.container}>
			<AppProviders client={createQueryClient(() => {})}>{children}</AppProviders>
		</ServicesProvider>
	);
}

function renderItem(isDefault: boolean, onOpen = vi.fn(), onSetDefault = vi.fn()) {
	render(
		<Menu>
			<MenuTrigger asChild>
				<button type="button">Applications</button>
			</MenuTrigger>
			<MenuContent>
				<OpenInItem
					app={cursor}
					isDefault={isDefault}
					onOpen={onOpen}
					onSetDefault={onSetDefault}
				/>
			</MenuContent>
		</Menu>,
		{ wrapper: providers() },
	);
	fireEvent.keyDown(screen.getByRole("button", { name: "Applications" }), { key: "Enter" });
	return { onOpen, onSetDefault };
}

describe("WS-08 OpenInItem", () => {
	it("WS-08 chooses the app when its item is selected", async () => {
		const { onOpen } = renderItem(false);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Cursor" }));
		expect(onOpen).toHaveBeenCalledWith(cursor);
	});

	it("WS-08 makes the app the default from its secondary action", async () => {
		const { onSetDefault } = renderItem(false);
		fireEvent.click(await screen.findByRole("button", { name: "Set as default" }));
		expect(onSetDefault).toHaveBeenCalledWith(cursor);
	});

	it("WS-08 marks the default app and offers no Set as default action for it", async () => {
		renderItem(true);
		expect(await screen.findByRole("menuitem", { name: "Cursor" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Set as default" })).toBeNull();
	});
});
