/**
 * @feature WS-08 Open-in button
 * Owns: the split button of the Open in control. The main part opens the default app, the arrow
 * opens the menu.
 * Behaviour: ui-map.md 3.10 (Cmd+O opens in the default app, Cmd+Shift+O opens the menu).
 * Must handle: a missing default app (the label reads "Open in"), an open in flight (spinner and a
 * disabled button while `busy`; the one-open-at-a-time guard is OpenInMenu's single flight), the
 * label and icon of the default app, a disabled reason, and the keyboard focus ring from the
 * shared button.
 * Test first: clicking the main part calls onOpenDefault once, even if clicked twice while busy.
 */
import { Button } from "../../ui/Button.tsx";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import { MenuTrigger } from "../../ui/Menu.tsx";
import { OpenInAppIcon } from "./OpenInItem.tsx";
import type { OpenInApp } from "./open-in-apps.ts";

export interface OpenInButtonProps {
	defaultApp: OpenInApp | null;
	busy: boolean;
	disabledReason: string | null;
	onOpenDefault: () => void;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
}

export function OpenInButton({
	defaultApp,
	busy,
	disabledReason,
	onOpenDefault,
	menuOpen,
	onMenuOpenChange,
}: OpenInButtonProps) {
	const disabled = disabledReason !== null;

	const openDefault = () => {
		if (busy || disabled) return;
		onOpenDefault();
	};

	return (
		<div className="flex items-center">
			<Button
				variant="outline"
				size="sm"
				className="rounded-r-none"
				loading={busy}
				disabled={disabled}
				title={disabledReason ?? undefined}
				onClick={openDefault}
			>
				{defaultApp === null ? (
					"Open in"
				) : (
					<>
						<OpenInAppIcon category={defaultApp.category} />
						<span className="max-w-32 truncate">{defaultApp.label}</span>
					</>
				)}
			</Button>
			<MenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="-ml-px rounded-l-none px-1.5"
					aria-label="Open in menu"
					aria-expanded={menuOpen}
					disabled={disabled}
					title={disabledReason ?? undefined}
					onClick={() => onMenuOpenChange(!menuOpen)}
				>
					<ChevronDownIcon />
				</Button>
			</MenuTrigger>
		</div>
	);
}
