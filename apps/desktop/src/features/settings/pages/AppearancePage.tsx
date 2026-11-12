/**
 * @feature SET-06 Appearance settings page
 * Owns: the Appearance page of Settings: theme, colours, zoom, fonts, and their previews.
 * Behaviour: ui-map.md 6, "Appearance" table; ui-map.md 8 (themes: light, dark, low-contrast dark,
 * colour-vision variants; code themes through Shiki). The page follows Conductor's page component
 * (FOa, renderApp): one list in this order, with its wording and controls.
 *   Theme                    "Toggle with" the live theme shortcut   select: Light, Dark, System
 *   Low-contrast dark mode   no description                          toggle
 *   App zoom                 "Adjust with <out> (zoom out) or <in> (zoom in)"  select of percentages
 *                                                                    in steps of 10 over the registry range
 *   Colored sidebar diffs                                            toggle
 *   Accessible colors                                                select
 *   Code theme               then the code preview                   select
 *   Mono Font                then its font preview                   select: Geist Mono, Custom... and a
 *                                                                    field with Conductor's hint
 *   Code ligatures                                                   toggle
 *   Markdown Style           then a rendered Markdown preview        select: Default, Tufte
 *   Terminal Font            a field and its hint, "Terminal Font Size" with its size in px and a
 *                            slider from 10 to 20, then the terminal preview
 * Children: appearance/CodePreview, appearance/TerminalPreview, chat/AssistantText for the Markdown
 * preview; rows from ../SettingRow.tsx inside ../SettingsPageFrame.tsx.
 * Our design choice: this page only edits the values. AppearanceController, mounted once at the app
 * root, writes the theme onto <html>, sends the zoom and window appearance on, and owns the theme
 * and zoom shortcuts, so they work on every screen. Conductor's Mono Font list also offers
 * "iA Writer Mono", a font we do not ship; it is left out. The preview texts are our own.
 * Must handle: the settings store loading, failing or dropping entries (the shared frame), a save
 * that fails (the stored value stays, a typed font or size goes back to it, and the row shows the
 * message), a font that is not installed (the previews keep their fallback lists), a stored terminal
 * size outside the slider (the text shows the stored size), a setting highlighted after a search
 * jump, and contrast: every theme combination keeps text at WCAG AA contrast (ui/app-14.test.tsx).
 * Test first: changing the code theme re-renders the code preview with that theme name.
 */
import { useEffect, useState } from "react";
import { useLiveShortcut, useSetting } from "../../../core/hooks.ts";
import {
	getSettingDef,
	pageDescriptionOf,
	type SettingDef,
} from "../../../core/registries/settings.ts";
import { cn } from "../../../ui/cn.ts";
import { Input } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Slider } from "../../../ui/Slider.tsx";
import { AssistantText } from "../../chat/AssistantText.tsx";
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

/** Conductor's zoom picker: every step of 10% over the registry's range (50% to 300%). */
const ZOOM_PERCENTS: readonly number[] = Array.from(
	{ length: Math.round((ZOOM.max - ZOOM.min) / ZOOM.step) + 1 },
	(_, index) => Math.round(ZOOM.min * 100) + index * Math.round(ZOOM.step * 100),
);

function ThemeRow({ focusSettingKey }: { focusSettingKey: string | null }) {
	const key = "theme";
	const def = requireDef(key);
	const saves = useSettingSaves();
	const value = useSetting<string>(key);
	const shortcut = useLiveShortcut("app.toggleTheme");
	return (
		<SettingRow
			settingKey={key}
			title={def.title}
			description={shortcut === null ? null : `Toggle with ${shortcut}`}
			disabledReason={null}
			highlighted={focusSettingKey === key}
			saveError={null}
		>
			<Select
				aria-label={def.title}
				className="w-36"
				value={value}
				options={def.type === "enum" ? def.options : []}
				onValueChange={(next) => void saves.save(key, next)}
			/>
		</SettingRow>
	);
}

function ZoomRow({ focusSettingKey, saves }: { focusSettingKey: string | null; saves: Saves }) {
	const key = "zoom_level_v2";
	const def = requireDef(key);
	const percent = Math.round(clampZoom(useSetting<number>(key)) * 100);
	const zoomOut = useLiveShortcut("view.zoomOut");
	const zoomIn = useLiveShortcut("view.zoomIn");
	return (
		<SettingRow
			settingKey={key}
			title={def.title}
			description={
				zoomOut === null || zoomIn === null
					? null
					: `Adjust with ${zoomOut} (zoom out) or ${zoomIn} (zoom in)`
			}
			disabledReason={null}
			highlighted={focusSettingKey === key}
			saveError={null}
		>
			<Select
				aria-label={def.title}
				className="w-36 tabular-nums"
				value={String(percent)}
				options={ZOOM_PERCENTS.map((option) => ({
					value: String(option),
					label: `${option}%`,
				}))}
				onValueChange={(next) => void saves.save(key, Number(next) / 100)}
			/>
		</SettingRow>
	);
}

function MonoFontRow({ focusSettingKey, saves }: { focusSettingKey: string | null; saves: Saves }) {
	const key = "mono_font";
	const def = requireDef(key);
	const fallback = def.type === "string" ? def.default : "";
	const value = useSetting<string>(key);
	const usesFallback = value.trim() === "" || value.trim() === fallback;
	const [customMode, setCustomMode] = useState(!usesFallback);
	const [draft, setDraft] = useState(usesFallback ? "" : value);

	useEffect(() => {
		const stored = value.trim() === "" || value.trim() === fallback;
		setCustomMode(!stored);
		setDraft(stored ? "" : value);
	}, [fallback, value]);

	const store = (next: string) => {
		void saves.save(key, next).then((saved) => {
			if (saved) return;
			setCustomMode(!usesFallback);
			setDraft(usesFallback ? "" : value);
		});
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
		<>
			<SettingRow
				settingKey={key}
				title={def.title}
				description={pageDescriptionOf(def)}
				disabledReason={null}
				highlighted={focusSettingKey === key}
				saveError={null}
			>
				<Select
					aria-label={def.title}
					className="w-44"
					value={customMode ? "custom" : "default"}
					options={[
						{ value: "default", label: fallback },
						{ value: "custom", label: "Custom..." },
					]}
					onValueChange={(mode) => {
						if (mode === "default") {
							setCustomMode(false);
							store(fallback);
							return;
						}
						setCustomMode(true);
					}}
				/>
			</SettingRow>
			{customMode ? (
				<div className="flex flex-col gap-2 pb-4">
					<Input
						aria-label={`${def.title} family`}
						value={draft}
						placeholder="Enter font name..."
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (event.key === "Enter") commit();
						}}
					/>
					<p className="text-xs text-fg-muted">
						Enter font name exactly as installed on your system
					</p>
				</div>
			) : null}
			<figure
				aria-label="Mono font preview"
				className="mb-5 rounded-md bg-muted p-3 text-sm text-fg"
				style={{ fontFamily: `"${value.trim() === "" ? fallback : value}", monospace` }}
			>
				{MONO_SAMPLE.map((line, index) => (
					<div key={line} className={index === 0 ? "text-fg-muted" : undefined}>
						{line}
					</div>
				))}
			</figure>
		</>
	);
}

/** Our own sample for the mono font preview: a comment line, then code with common ligature pairs. */
const MONO_SAMPLE: readonly string[] = [
	"// The quick brown fox",
	"const total = items.reduce((sum, item) => sum + item, 0);",
	"if (total !== 0) console.log(total, '=> ok');",
];

/** Our own sample for the Markdown preview, rendered in the chosen style. */
const MARKDOWN_SAMPLE =
	"# Release notes\n\nThe preview shows how a **Markdown** file reads in this style.";

function TerminalFontBlock({
	focusSettingKey,
	saves,
}: {
	focusSettingKey: string | null;
	saves: Saves;
}) {
	const familyKey = "terminal_font_family";
	const sizeKey = "terminal_font_size";
	const familyDef = requireDef(familyKey);
	const sizeDef = requireDef(sizeKey);
	const family = useSetting<string>(familyKey);
	const size = useSetting<number>(sizeKey);
	const [draft, setDraft] = useState(family);
	useEffect(() => setDraft(family), [family]);

	const commit = () => {
		const chosen = draft.trim();
		if (chosen === family.trim()) return;
		void saves.save(familyKey, chosen).then((saved) => {
			if (!saved) setDraft(family);
		});
	};
	const highlighted = focusSettingKey === familyKey || focusSettingKey === sizeKey;

	return (
		<div
			id={`setting-${familyKey}`}
			data-setting-key={familyKey}
			data-highlighted={highlighted ? "true" : undefined}
			className={cn(
				"flex flex-col gap-4 border-t border-border py-5",
				highlighted && "rounded-md bg-accent/10 px-3 ring-1 ring-accent",
			)}
		>
			<div className="flex flex-col gap-2">
				<label htmlFor="terminal-font-family" className="text-sm font-medium text-fg">
					{familyDef.title}
				</label>
				<Input
					id="terminal-font-family"
					value={draft}
					placeholder="Leave empty for default"
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
					}}
				/>
				<p className="text-xs text-fg-muted">{familyDef.description}</p>
			</div>
			<div data-setting-key={sizeKey} className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium text-fg">{sizeDef.title}</span>
					<span className="text-sm text-fg-muted">{size}px</span>
				</div>
				<Slider
					value={Math.min(TERMINAL_SIZE.max, Math.max(TERMINAL_SIZE.min, size))}
					min={TERMINAL_SIZE.min}
					max={TERMINAL_SIZE.max}
					step={1}
					onValueChange={(next) => void saves.save(sizeKey, next)}
					formatValue={(next) => `${next}px`}
					aria-label={sizeDef.title}
				/>
			</div>
			<TerminalPreview fontFamily={family} fontSize={size} />
		</div>
	);
}

/** Conductor's terminal size slider runs from 10 to 20. */
const TERMINAL_SIZE = { min: 10, max: 20 } as const;

export function AppearancePage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const saves = useSettingSaves();
	const codeTheme = useSetting<string>("code_theme");
	const monoFont = useSetting<string>("mono_font");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const row = (settingKey: string) => (
		<RegistrySettingRowByKey settingKey={settingKey} focusSettingKey={focusSettingKey} />
	);

	return (
		<SettingsPageFrame
			title="Appearance"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			{/* Conductor's page is one list with no section headings (FOa, renderApp @11301088),
			    each preview under its own row (D098). */}
			<div className="flex flex-col">
				<ThemeRow focusSettingKey={focusSettingKey} />
				{row("low_contrast_dark_mode")}
				<ZoomRow focusSettingKey={focusSettingKey} saves={saves} />
				{row("colored_sidebar_diffs")}
				{row("color_vision")}
				{row("code_theme")}
				<div className="pb-5">
					<CodePreview
						themeName={codeTheme}
						fontFamily={monoFont === "" ? null : monoFont}
						ligatures={ligatures}
					/>
				</div>
				<MonoFontRow focusSettingKey={focusSettingKey} saves={saves} />
				{row("file_ligatures_enabled")}
				{row("markdown_style")}
				<figure aria-label="Markdown preview" className="mb-5 rounded-md bg-muted p-4">
					<AssistantText text={MARKDOWN_SAMPLE} />
				</figure>
				<TerminalFontBlock focusSettingKey={focusSettingKey} saves={saves} />
			</div>
		</SettingsPageFrame>
	);
}
