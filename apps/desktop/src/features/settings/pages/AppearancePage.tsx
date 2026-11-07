/**
 * @feature SET-06 Appearance settings page
 * Owns: the Appearance page of Settings: theme, colours, zoom, fonts, and live previews.
 * Behaviour: ui-map.md 6, "Appearance" table and "Appearance page" (live code preview and a
 * terminal preview block); ui-map.md 8 (themes: light, dark, low-contrast dark, colour-vision
 * variants; code themes through Shiki).
 * Rows (registry titles), key, control:
 *   Theme                         theme                        select: Light, Dark, System
 *   Softer dark theme             low_contrast_dark_mode       toggle
 *   Color vision palette          color_vision                 select: Default, Protanopia and
 *                                                              deuteranopia, Tritanopia
 *   App zoom                      zoom_level_v2                slider with a reset
 *   Code theme                    code_theme                   select (Shiki bundled themes)
 *   Code font                     mono_font                    select Default or Custom, plus a field
 *   Code ligatures                file_ligatures_enabled       toggle
 *   Markdown style                markdown_style               select: Default, Tufte
 *   Terminal font                 terminal_font_family         select Default or Custom, plus a field
 *   Terminal font size            terminal_font_size           number field
 *   Colored line counts in the    colored_sidebar_diffs        toggle
 *   sidebar
 * Children: appearance/CodePreview, appearance/TerminalPreview; rows from ../SettingRow.tsx inside
 * ../SettingsPageFrame.tsx.
 * Our design choice: this page only edits the values. AppearanceController, mounted once at the app
 * root, writes the theme onto <html>, sends the zoom and window appearance on, and owns the theme
 * and zoom shortcuts, so they work on every screen.
 * Rows with a plain control come from the registry (RegistrySettingRowByKey). The zoom slider and
 * the two font rows are SettingRow with their own control, saved through useSettingSaves. The
 * "Default" font is the registry's default for that key.
 * Must handle: the settings store loading, failing or dropping entries (the shared frame), a save
 * that fails (the stored value stays, a typed font or size goes back to it, and the row shows the
 * message), a font that is not installed (the preview keeps its fallback list), the registry's zoom
 * limits, a setting highlighted after a search jump, and contrast: every theme
 * combination keeps text at WCAG AA contrast (ui/app-14.test.tsx).
 * Test first: changing the code theme re-renders the code preview with that theme name.
 */
import { useEffect, useState } from "react";
import { useSetting } from "../../../core/hooks.ts";
import { getSettingDef, type SettingDef } from "../../../core/registries/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Slider } from "../../../ui/Slider.tsx";
import { clampZoom, ZOOM } from "../appearance/AppearanceController.tsx";
import { CodePreview } from "../appearance/CodePreview.tsx";
import { TerminalPreview } from "../appearance/TerminalPreview.tsx";
import { RegistrySettingRowByKey, SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

type Saves = ReturnType<typeof useSettingSaves>;

/** The registry entry of a key this page draws by hand. A missing entry is a programming error. */
function requireDef(key: string): SettingDef {
	const def = getSettingDef(key);
	if (def === undefined) throw new Error(`The settings registry has no "${key}".`);
	return def;
}

function ZoomRow({ focusSettingKey, saves }: { focusSettingKey: string | null; saves: Saves }) {
	const key = "zoom_level_v2";
	const def = requireDef(key);
	const shown = clampZoom(useSetting<number>(key));
	return (
		<SettingRow
			settingKey={key}
			title={def.title}
			description={def.description}
			scope="user"
			disabledReason={null}
			highlighted={focusSettingKey === key}
			saveError={saves.errorOf(key)}
		>
			<div className="flex w-72 items-center gap-3">
				<Slider
					value={shown}
					min={ZOOM.min}
					max={ZOOM.max}
					step={ZOOM.step}
					onValueChange={(next) => void saves.save(key, next)}
					formatValue={(next) => `${Math.round(next * 100)}%`}
					aria-label={def.title}
				/>
				<span className="w-10 text-right text-sm text-fg-muted">{Math.round(shown * 100)}%</span>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void saves.save(key, ZOOM.default)}
					disabled={shown === ZOOM.default}
				>
					Reset
				</Button>
			</div>
		</SettingRow>
	);
}

function FontRow({
	settingKey,
	placeholder,
	focusSettingKey,
	saves,
}: {
	settingKey: string;
	placeholder: string;
	focusSettingKey: string | null;
	saves: Saves;
}) {
	const def = requireDef(settingKey);
	const fallback = def.type === "string" ? def.default : "";
	const value = useSetting<string>(settingKey);
	const usesFallback = value.trim() === fallback;
	const [customMode, setCustomMode] = useState(!usesFallback);
	const [draft, setDraft] = useState(usesFallback ? "" : value);

	// Shows the stored value: after it changes, and after a save that did not store the typed one.
	const showStored = () => {
		setCustomMode(!usesFallback);
		setDraft(usesFallback ? "" : value);
	};

	useEffect(() => {
		setCustomMode(value.trim() !== fallback);
		setDraft(value.trim() === fallback ? "" : value);
	}, [fallback, value]);

	const store = (next: string) => {
		void saves.save(settingKey, next).then((saved) => {
			if (!saved) showStored();
		});
	};

	const choose = (mode: string) => {
		if (mode === "default") {
			setCustomMode(false);
			store(fallback);
			return;
		}
		setCustomMode(true);
	};

	const commit = () => {
		const chosen = draft.trim();
		if (chosen === "") {
			setCustomMode(false);
			store(fallback);
			return;
		}
		store(chosen);
	};

	return (
		<SettingRow
			settingKey={settingKey}
			title={def.title}
			description={def.description}
			scope="user"
			disabledReason={null}
			highlighted={focusSettingKey === settingKey}
			saveError={saves.errorOf(settingKey)}
		>
			<div className="flex flex-col items-start gap-2">
				<Select
					value={customMode ? "custom" : "default"}
					options={[
						{ value: "default", label: "Default" },
						{ value: "custom", label: "Custom..." },
					]}
					onValueChange={choose}
					aria-label={`${def.title} style`}
				/>
				{customMode ? (
					<Input
						aria-label={`${def.title} family`}
						value={draft}
						placeholder={placeholder}
						className="w-56"
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (event.key === "Enter") commit();
						}}
					/>
				) : null}
			</div>
		</SettingRow>
	);
}

export function AppearancePage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const saves = useSettingSaves();
	const codeTheme = useSetting<string>("code_theme");
	const monoFont = useSetting<string>("mono_font");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const terminalFont = useSetting<string>("terminal_font_family");
	const terminalSize = useSetting<number>("terminal_font_size");
	const row = (settingKey: string) => (
		<RegistrySettingRowByKey settingKey={settingKey} focusSettingKey={focusSettingKey} />
	);

	return (
		<SettingsPageFrame
			title="Appearance"
			description="Theme, colours, zoom, fonts, and live previews."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="flex flex-col gap-6">
				<section aria-labelledby="appearance-colours" className="flex flex-col">
					<h2 id="appearance-colours" className="mb-1 text-lg font-medium text-fg">
						Theme and colours
					</h2>
					{row("theme")}
					{row("low_contrast_dark_mode")}
					{row("color_vision")}
				</section>

				<section aria-labelledby="appearance-display" className="flex flex-col">
					<h2 id="appearance-display" className="mb-1 text-lg font-medium text-fg">
						Display
					</h2>
					<ZoomRow focusSettingKey={focusSettingKey} saves={saves} />
					{row("colored_sidebar_diffs")}
				</section>

				<section aria-labelledby="appearance-fonts" className="flex flex-col">
					<h2 id="appearance-fonts" className="mb-1 text-lg font-medium text-fg">
						Fonts and code
					</h2>
					{row("code_theme")}
					<FontRow
						settingKey="mono_font"
						placeholder="Enter font name..."
						focusSettingKey={focusSettingKey}
						saves={saves}
					/>
					{row("file_ligatures_enabled")}
					{row("markdown_style")}
					<FontRow
						settingKey="terminal_font_family"
						placeholder="Leave empty for default"
						focusSettingKey={focusSettingKey}
						saves={saves}
					/>
					{row("terminal_font_size")}
				</section>

				<section aria-labelledby="appearance-previews" className="flex flex-col gap-3">
					<h2 id="appearance-previews" className="text-lg font-medium text-fg">
						Live preview
					</h2>
					<div className="grid gap-4 2xl:grid-cols-2">
						<CodePreview
							themeName={codeTheme}
							fontFamily={monoFont === "" ? null : monoFont}
							ligatures={ligatures}
						/>
						<TerminalPreview fontFamily={terminalFont} fontSize={terminalSize} />
					</div>
				</section>
			</div>
		</SettingsPageFrame>
	);
}
