/**
 * @feature RUN-06 Big terminal mode
 * Owns: the Big terminal settings block on the Experimental page: the New tab preset list with
 * each preset's command, the user's own commands, and the "Add custom command" button.
 * Behaviour: ui-map.md 6, "Big terminal" (renderApp @10675300: title "Big terminal settings",
 * description "Configure the experimental center-pane terminal.", "New tab preset", each row's
 * command on the right, and a custom command's input with placeholder "my-agent --flag").
 * Our design choice: the section sits on our Experimental page instead of Conductor's own Terminal
 * settings tab (D098 keeps the setting where our page groups it); its rows are the registry's two
 * keys, drawn here so a preset shows its command as Conductor's rows do.
 * Must handle: big terminal mode off (nothing shows), no preset chosen, a custom command chosen,
 * a custom line that is empty (the placeholder shows), and a save that fails (the row says so).
 * Test first: stores the chosen preset.
 */
import { useEffect, useState } from "react";
import { useActions, useSetting } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input } from "../../ui/Input.tsx";
import { toastError } from "../../ui/Toast.tsx";
import {
	BIG_TERMINAL_PRESETS,
	bigTerminalPresetCommand,
	customTerminalCommands,
} from "./big-terminal.ts";

export interface BigTerminalSettingsProps {
	/** The setting a settings-search result asked to show. */
	focusSettingKey?: string | null;
}

/** The preset list and custom commands, shown only while Big terminal mode is on. */
export function BigTerminalSettings({ focusSettingKey = null }: BigTerminalSettingsProps) {
	const actions = useActions();
	const enabled = useSetting<boolean>("experimental_big_terminal_mode");
	const preset = useSetting<string>("big_terminal_preset");
	const storedCommands = useSetting<string>("big_terminal_custom_commands");
	const toolApprovals = useSetting<boolean>("tool_approvals_enabled");
	const [lines, setLines] = useState<string[]>(() => customTerminalCommands(storedCommands));
	useEffect(() => {
		setLines(customTerminalCommands(storedCommands));
	}, [storedCommands]);

	if (!enabled) return null;

	const selected = preset === "" ? "none" : preset;
	const savePreset = (value: string): void => {
		void actions.settings.set("big_terminal_preset", value).then((saved) => {
			if (!saved.ok) toastError("Couldn't save the preset", saved.error);
		});
	};
	const saveCommands = (next: string[]): void => {
		setLines(next);
		void actions.settings.set("big_terminal_custom_commands", next.join("\n")).then((saved) => {
			if (!saved.ok) toastError("Couldn't save the custom commands", saved.error);
		});
	};

	const rows = [
		...BIG_TERMINAL_PRESETS,
		...lines.map((command, index) => ({
			value: `custom:${index}`,
			label: "Custom command",
			command,
		})),
	];

	return (
		<section
			aria-label="Big terminal settings"
			data-setting-section="big-terminal"
			className={cn(
				"flex flex-col gap-4 border-t border-border pt-6",
				focusSettingKey === "big_terminal_preset" ||
					focusSettingKey === "big_terminal_custom_commands"
					? "rounded-md ring-2 ring-focus"
					: "",
			)}
		>
			<div className="flex flex-col gap-0.5">
				<h3 className="text-base font-medium text-fg">Big terminal settings</h3>
				<p className="text-sm text-fg-muted">Configure the experimental center-pane terminal.</p>
			</div>
			<fieldset className="flex flex-col gap-3">
				<legend className="flex flex-col gap-0.5">
					<span className="text-sm font-medium text-fg">New tab preset</span>
					<span className="text-sm text-fg-muted">
						Command to auto-run when creating a new terminal tab.
					</span>
				</legend>
				<div className="flex flex-col gap-1.5">
					{rows.map((row) => (
						<label
							key={row.value}
							className={cn(
								"flex min-w-0 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors",
								selected === row.value
									? "border-accent bg-accent/20"
									: "border-transparent hover:bg-hover",
							)}
						>
							<input
								type="radio"
								name="big-terminal-preset"
								value={row.value}
								checked={selected === row.value}
								onChange={() => savePreset(row.value)}
								className="sr-only"
							/>
							<span className="shrink-0 text-sm font-medium text-fg">{row.label}</span>
							{row.value === "none" ? null : (
								<span className="ml-auto min-w-0 flex-1 truncate text-right font-mono text-xs text-fg-muted">
									{row.command === ""
										? "No command set"
										: row.value.startsWith("custom:")
											? row.command
											: bigTerminalPresetCommand(row.value, toolApprovals)}
								</span>
							)}
						</label>
					))}
				</div>
				{lines.map((command, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a custom command line has no id; its position names it.
					<div key={`custom-line-${index}`} className="flex items-center gap-2 pl-6">
						<Input
							aria-label="Custom command"
							value={command}
							placeholder="my-agent --flag"
							autoComplete="new-password"
							autoCorrect="off"
							autoCapitalize="off"
							spellCheck={false}
							className="w-64 font-mono text-xs"
							onChange={(event) => {
								const next = [...lines];
								next[index] = event.target.value;
								setLines(next);
							}}
							onBlur={() => saveCommands(lines)}
						/>
					</div>
				))}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="mt-1 w-fit gap-2 text-fg-muted hover:text-fg"
					onClick={() => setLines([...lines, ""])}
				>
					Add custom command
				</Button>
			</fieldset>
		</section>
	);
}
