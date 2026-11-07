/**
 * @feature WS-08 Open-in button
 * Owns: tests for the split button: its default app label, one open per click at a time, its menu
 * arrow and its disabled reason.
 * Behaviour: ui-map.md 3.10.
 * Test first: clicking the main part calls onOpenDefault once, even if clicked twice while busy.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { Menu } from "../../ui/Menu.tsx";
import { OpenInButton } from "./OpenInButton.tsx";
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

describe("WS-08 OpenInButton", () => {
	it("WS-08 opens the default app once even when clicked twice", () => {
		const onOpenDefault = vi.fn();
		const button = (busy: boolean) => (
			<Menu>
				<OpenInButton
					defaultApp={cursor}
					busy={busy}
					disabledReason={null}
					onOpenDefault={onOpenDefault}
					menuOpen={false}
					onMenuOpenChange={vi.fn()}
				/>
			</Menu>
		);
		const { rerender } = render(button(false), { wrapper: providers() });
		const main = screen.getByRole("button", { name: /Cursor/ });
		fireEvent.click(main);
		// The parent marks the open as busy, as OpenInMenu does while the app opens.
		rerender(button(true));
		fireEvent.click(main);
		expect(onOpenDefault).toHaveBeenCalledTimes(1);
	});

	it("WS-08 keeps answering clicks that only open the menu", () => {
		const onOpenDefault = vi.fn();
		render(
			<Menu>
				<OpenInButton
					defaultApp={null}
					busy={false}
					disabledReason={null}
					onOpenDefault={onOpenDefault}
					menuOpen={false}
					onMenuOpenChange={vi.fn()}
				/>
			</Menu>,
			{ wrapper: providers() },
		);
		const main = screen.getByRole("button", { name: "Open in" });
		fireEvent.click(main);
		fireEvent.click(main);
		expect(onOpenDefault).toHaveBeenCalledTimes(2);
	});

	it("WS-08 shows the default app's label and blocks the main part while busy", () => {
		const onOpenDefault = vi.fn();
		render(
			<Menu>
				<OpenInButton
					defaultApp={cursor}
					busy
					disabledReason={null}
					onOpenDefault={onOpenDefault}
					menuOpen={false}
					onMenuOpenChange={vi.fn()}
				/>
			</Menu>,
			{ wrapper: providers() },
		);
		const main = screen.getByRole("button", { name: /Cursor/ });
		expect((main as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(main);
		expect(onOpenDefault).not.toHaveBeenCalled();
	});

	it("WS-08 opens the menu from the arrow and disables both parts with a reason", () => {
		const onMenuOpenChange = vi.fn();
		const { rerender } = render(
			<Menu>
				<OpenInButton
					defaultApp={cursor}
					busy={false}
					disabledReason={null}
					onOpenDefault={vi.fn()}
					menuOpen={false}
					onMenuOpenChange={onMenuOpenChange}
				/>
			</Menu>,
			{ wrapper: providers() },
		);
		fireEvent.click(screen.getByRole("button", { name: "Open in menu" }));
		expect(onMenuOpenChange).toHaveBeenCalledWith(true);

		rerender(
			<Menu>
				<OpenInButton
					defaultApp={cursor}
					busy={false}
					disabledReason="This workspace is archived."
					onOpenDefault={vi.fn()}
					menuOpen={false}
					onMenuOpenChange={onMenuOpenChange}
				/>
			</Menu>,
		);
		expect((screen.getByRole("button", { name: /Cursor/ }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(screen.getByRole("button", { name: "Open in menu" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});
});
