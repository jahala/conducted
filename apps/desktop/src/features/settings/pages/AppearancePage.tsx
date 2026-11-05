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
 * Children: appearance/CodePreview, appearance/TerminalPreview.
 * Our design choice: appearance attributes are written to <html> while this page is mounted, and app
 * zoom is applied as CSS zoom on <html>. Both survive leaving the page. Mounting the attributes before
 * the first paint, and registering the theme and zoom shortcuts for the whole app, belong to the app
 * root, which this feature does not own.
 * Must handle: the settings store reporting a failed load or dropped entries, a save that fails (the
 * value rolls back and the row shows the message), a font that is not installed (the preview keeps
 * its fallback list), zoom limits of 50% to 200%, System theme following macOS, and contrast: every
 * theme combination keeps text at WCAG AA contrast (ui/app-14.test.tsx).
 * Test first: changing the code theme re-renders the code preview with that theme name.
 */
import type { Result } from "@conducted/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useSetting } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { Alert, AlertDescription, AlertTitle } from "../../../ui/Alert.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { Select, type SelectOption } from "../../../ui/Select.tsx";
import { Slider } from "../../../ui/Slider.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import {
	applyThemeOnChange,
	type StoredThemeValues,
	type ThemeChoice,
} from "../../../ui/theme-variants.ts";
import { CodePreview } from "../appearance/CodePreview.tsx";
import { TerminalPreview } from "../appearance/TerminalPreview.tsx";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1;

/** Keeps the zoom inside the page's 50% to 200% range and rounds to two decimals. */
export function clampZoom(value: number): number {
	if (!Number.isFinite(value)) return ZOOM_DEFAULT;
	const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
	return Math.round(clamped * 100) / 100;
}

/** One step in or out from the current zoom, never past the limits. */
export function steppedZoom(value: number, direction: 1 | -1): number {
	return clampZoom(value + direction * ZOOM_STEP);
}

/** Writes the app zoom onto the document element. Returns the value that was applied. */
export function applyZoom(
	root: { style: { setProperty(name: string, value: string): void } },
	value: number,
): number {
	const applied = clampZoom(value);
	root.style.setProperty("zoom", String(applied));
	return applied;
}

function titleOf(key: string): string {
	return getSettingDef(key)?.title ?? key;
}

function descriptionOf(key: string): string | null {
	return getSettingDef(key)?.description ?? null;
}

function optionsOf(key: string): SelectOption<string>[] {
	const def = getSettingDef(key);
	return def?.type === "enum"
		? def.options.map((option) => ({ value: option.value, label: option.label }))
		: [];
}

function useSettingSaver(key: string) {
	const actions = useActions();
	const [error, setError] = useState<string | null>(null);
	const save = useCallback(
		async (value: unknown) => {
			setError(null);
			const result = await actions.settings.set(key, value);
			if (!result.ok) setError(result.error.message);
			return result;
		},
		[actions, key],
	);
	return { save, error };
}

function saveInBackground(save: () => Promise<Result<void>>, title: string): void {
	void save().then((result) => {
		if (!result.ok) toastError(title, result.error);
	});
}

interface AppearanceRowProps {
	title: string;
	description: string | null;
	error: string | null;
	children: ReactNode;
}

function AppearanceRow({ title, description, error, children }: AppearanceRowProps) {
	return (
		<div className="flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex max-w-xl flex-col gap-1">
				<p className="text-sm font-medium text-fg">{title}</p>
				{description === null ? null : <p className="text-sm text-fg-muted">{description}</p>}
				{error === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{error}
					</p>
				)}
			</div>
			<div className="sm:shrink-0">{children}</div>
		</div>
	);
}

function ToggleRow({ settingKey }: { settingKey: string }) {
	const value = useSetting<boolean>(settingKey);
	const { save, error } = useSettingSaver(settingKey);
	const title = titleOf(settingKey);
	return (
		<AppearanceRow title={title} description={descriptionOf(settingKey)} error={error}>
			<Switch checked={value} onCheckedChange={(next) => void save(next)} aria-label={title} />
		</AppearanceRow>
	);
}

function SelectRow({ settingKey }: { settingKey: string }) {
	const value = useSetting<string>(settingKey);
	const { save, error } = useSettingSaver(settingKey);
	const title = titleOf(settingKey);
	return (
		<AppearanceRow title={title} description={descriptionOf(settingKey)} error={error}>
			<Select
				value={value}
				options={optionsOf(settingKey)}
				onValueChange={(next) => void save(next)}
				aria-label={title}
			/>
		</AppearanceRow>
	);
}

function NumberFieldRow({
	settingKey,
	min,
	max,
}: {
	settingKey: string;
	min: number;
	max: number;
}) {
	const value = useSetting<number>(settingKey);
	const { save, error } = useSettingSaver(settingKey);
	const [draft, setDraft] = useState(String(value));
	const title = titleOf(settingKey);

	useEffect(() => {
		setDraft(String(value));
	}, [value]);

	const commit = () => {
		const parsed = Number(draft);
		if (draft.trim() === "" || !Number.isFinite(parsed)) {
			setDraft(String(value));
			return;
		}
		void save(parsed);
	};

	return (
		<AppearanceRow title={title} description={descriptionOf(settingKey)} error={error}>
			<Input
				aria-label={title}
				type="number"
				min={min}
				max={max}
				value={draft}
				className="w-24"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
				}}
			/>
		</AppearanceRow>
	);
}

function FontRow({
	settingKey,
	fallback,
	placeholder,
}: {
	settingKey: string;
	fallback: string;
	placeholder: string;
}) {
	const value = useSetting<string>(settingKey);
	const { save, error } = useSettingSaver(settingKey);
	const title = titleOf(settingKey);
	const usesFallback = value.trim() === fallback;
	const [customMode, setCustomMode] = useState(!usesFallback);
	const [draft, setDraft] = useState(usesFallback ? "" : value);

	useEffect(() => {
		setCustomMode(value.trim() !== fallback);
		setDraft(value.trim() === fallback ? "" : value);
	}, [fallback, value]);

	const choose = (mode: string) => {
		if (mode === "default") {
			setCustomMode(false);
			void save(fallback);
			return;
		}
		setCustomMode(true);
	};

	const commit = () => {
		const chosen = draft.trim();
		if (chosen === "") {
			setCustomMode(false);
			void save(fallback);
			return;
		}
		void save(chosen);
	};

	return (
		<AppearanceRow title={title} description={descriptionOf(settingKey)} error={error}>
			<div className="flex flex-col items-start gap-2">
				<Select
					value={customMode ? "custom" : "default"}
					options={[
						{ value: "default", label: "Default" },
						{ value: "custom", label: "Custom" },
					]}
					onValueChange={choose}
					aria-label={`${title} style`}
				/>
				{customMode ? (
					<Input
						aria-label={`${title} family`}
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
		</AppearanceRow>
	);
}

function ZoomRow() {
	const zoom = useSetting<number>("zoom_level_v2");
	const { save, error } = useSettingSaver("zoom_level_v2");
	const title = titleOf("zoom_level_v2");
	const shown = clampZoom(zoom);
	return (
		<AppearanceRow title={title} description={descriptionOf("zoom_level_v2")} error={error}>
			<div className="flex w-72 items-center gap-3">
				<Slider
					value={shown}
					min={ZOOM_MIN}
					max={ZOOM_MAX}
					step={ZOOM_STEP}
					onValueChange={(next) => void save(next)}
					formatValue={(next) => `${Math.round(next * 100)}%`}
					aria-label={title}
				/>
				<span className="w-10 text-right text-sm text-fg-muted">{Math.round(shown * 100)}%</span>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => void save(ZOOM_DEFAULT)}
					disabled={shown === ZOOM_DEFAULT}
				>
					Reset
				</Button>
			</div>
		</AppearanceRow>
	);
}

export function AppearancePage() {
	const { services, platform } = useServices();
	const actions = useActions();
	const codeTheme = useSetting<string>("code_theme");
	const monoFont = useSetting<string>("mono_font");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const terminalFont = useSetting<string>("terminal_font_family");
	const terminalSize = useSetting<number>("terminal_font_size");
	const zoom = useSetting<number>("zoom_level_v2");
	const warnings = useStore(services.settings.store, (state) => state.warnings);
	const dropped = useStore(services.settings.store, (state) => state.dropped);

	useEffect(() => {
		return applyThemeOnChange(
			document.documentElement,
			{
				read: (): StoredThemeValues => ({
					theme: services.settings.get<unknown>("theme"),
					lowContrastDark: services.settings.get<unknown>("low_contrast_dark_mode"),
					colorVision: services.settings.get<unknown>("color_vision"),
					vibrancy: services.settings.get<unknown>("experimental_sidebar_transparency"),
				}),
				subscribe: (listener) => services.settings.store.subscribe(listener),
			},
			(key, value) => {
				platform.app.writeLog("warn", "Unknown appearance setting value", {
					key,
					value,
				});
			},
		);
	}, [platform, services]);

	useEffect(() => {
		applyZoom(document.documentElement, zoom);
	}, [zoom]);

	useCommandHandler("app.toggleTheme", "base", () => {
		const current = services.settings.get<ThemeChoice>("theme");
		saveInBackground(
			() => actions.settings.set("theme", current === "dark" ? "light" : "dark"),
			"Couldn't switch the theme",
		);
		return true;
	});

	useCommandHandler("view.zoomIn", "base", () => {
		const current = services.settings.get<number>("zoom_level_v2");
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", steppedZoom(current, 1)),
			"Couldn't zoom in",
		);
		return true;
	});

	useCommandHandler("view.zoomOut", "base", () => {
		const current = services.settings.get<number>("zoom_level_v2");
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", steppedZoom(current, -1)),
			"Couldn't zoom out",
		);
		return true;
	});

	useCommandHandler("view.zoomReset", "base", () => {
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", ZOOM_DEFAULT),
			"Couldn't reset the zoom",
		);
		return true;
	});

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Appearance</h1>
				<p className="text-sm text-fg-muted">Theme, colours, zoom, fonts, and live previews.</p>
			</header>

			{warnings.length === 0 ? null : (
				<Alert tone="destructive">
					<AlertTitle>Couldn&apos;t load all settings</AlertTitle>
					<AlertDescription>
						{warnings.map((warning) => warning.message).join(" ")}
					</AlertDescription>
				</Alert>
			)}

			{dropped.length === 0 ? null : (
				<Alert>
					<AlertTitle>Some settings were ignored</AlertTitle>
					<AlertDescription>
						{dropped.length === 1
							? "One saved entry could not be used."
							: `${dropped.length} saved entries could not be used.`}
					</AlertDescription>
				</Alert>
			)}

			<section aria-labelledby="appearance-colours" className="flex flex-col">
				<h2 id="appearance-colours" className="mb-1 text-lg font-medium text-fg">
					Theme and colours
				</h2>
				<SelectRow settingKey="theme" />
				<ToggleRow settingKey="low_contrast_dark_mode" />
				<SelectRow settingKey="color_vision" />
			</section>

			<section aria-labelledby="appearance-display" className="flex flex-col">
				<h2 id="appearance-display" className="mb-1 text-lg font-medium text-fg">
					Display
				</h2>
				<ZoomRow />
				<ToggleRow settingKey="colored_sidebar_diffs" />
			</section>

			<section aria-labelledby="appearance-fonts" className="flex flex-col">
				<h2 id="appearance-fonts" className="mb-1 text-lg font-medium text-fg">
					Fonts and code
				</h2>
				<SelectRow settingKey="code_theme" />
				<FontRow settingKey="mono_font" fallback="Geist Mono" placeholder="e.g. Berkeley Mono" />
				<ToggleRow settingKey="file_ligatures_enabled" />
				<SelectRow settingKey="markdown_style" />
				<FontRow settingKey="terminal_font_family" fallback="" placeholder="e.g. Menlo" />
				<NumberFieldRow settingKey="terminal_font_size" min={8} max={32} />
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
	);
}
