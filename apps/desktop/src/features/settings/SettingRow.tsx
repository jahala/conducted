/**
 * @feature SET-02 Setting row and setting controls
 * Owns: the layout of one setting (title, description, reset action and the control on the right),
 * the control for a registry setting, and the save state pages share. A row shows no "User" or
 * "Repository" marker, as Conductor's rows show none (D098).
 * Behaviour: ui-map.md 6 (each setting has a title, a description and scopes user or repository;
 * per-repository settings offer a reset to the shared file's value). Row actions sit behind the
 * menu button Conductor names "Setting actions", whose one item is Reset (renderApp @8700214).
 * Our design choice: the control is passed in as children, so one row serves toggles, selects,
 * text fields and custom blocks. `RegistrySettingRows` renders a page's settings from the registry
 * so every page uses one control implementation.
 * Must handle: a long description (wraps, no truncation), a switch whose stored key says the
 * opposite of its title (shown and saved inverted), a disabled setting with a reason (the
 * fieldset disables the control), a setting that is highlighted after a search jump, and a save
 * that fails: a toast with Conductor's words (main @389730), with its "Overwrite file" button for
 * an invalid file the app can save over (a typed number, text or list that was not saved goes back
 * to the stored value, so the field never shows a value the app does not hold), and a Reset that
 * fails (the same toast for a file-backed setting, "Failed to reset setting" for a table row's).
 * Test first: with a disabledReason the control is disabled and the reason is shown.
 */

import type { AppError } from "@conducted/shared";
import {
	Children,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting } from "../../core/hooks.ts";
import {
	getSettingDef,
	pageDescriptionOf,
	type SettingDef,
	type SettingPage,
	type SettingValue,
	settingsForPage,
} from "../../core/registries/settings.ts";
import { type OverwriteAndSave, tellSettingSaveFailed } from "../../core/setting-save-notice.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input, Label, Textarea } from "../../ui/Input.tsx";
import { MoreHorizontalIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { Select } from "../../ui/Select.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { ExternalLink } from "../chat/ExternalLink.tsx";

const DISABLED_TAGS = new Set(["input", "button", "select", "textarea", "fieldset"]);

/** Passes the disabled state to the controls a row holds, so every control reports it directly. */
function withDisabled(children: ReactNode, disabled: boolean): ReactNode {
	return Children.map(children, (child) => {
		if (!isValidElement(child)) return child;
		const type = child.type;
		const acceptsDisabled =
			typeof type === "function" || (typeof type === "string" && DISABLED_TAGS.has(type));
		if (!acceptsDisabled) return child;
		const already = (child.props as { disabled?: boolean }).disabled === true;
		return cloneElement(child as ReactElement<{ disabled?: boolean }>, {
			disabled: disabled || already,
		});
	});
}

export interface SettingRowProps {
	settingKey: string;
	title: string;
	/** Plain text, or text with a link (Conductor's "configure it on GitHub", "Learn more"). */
	description: ReactNode | null;
	/** A small hint under the description. */
	detail?: string | null;
	/** "warning" draws the detail in the warning colour. */
	detailTone?: "warning";
	/** Why the control cannot change now. Set, it disables the control and shows under the text. */
	disabledReason: ReactNode | null;
	highlighted: boolean;
	saveError: string | null;
	/** Conductor's row actions menu holds this one Reset action, when the row has one to offer. */
	onReset?: () => void;
	/** The menu item's label (Conductor's default is "Reset"). */
	resetLabel?: string;
	/** The control sits under the text at full width, as Conductor lays out path fields. */
	stacked?: boolean;
	children: ReactNode;
}

export function SettingRow({
	settingKey,
	title,
	description,
	detail = null,
	detailTone,
	disabledReason,
	highlighted,
	saveError,
	onReset,
	resetLabel = "Reset",
	stacked = false,
	children,
}: SettingRowProps) {
	const descriptionId = `setting-${settingKey}-description`;
	return (
		<div
			id={`setting-${settingKey}`}
			data-setting-key={settingKey}
			data-highlighted={highlighted ? "true" : undefined}
			className={cn(
				"relative flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0",
				highlighted && "rounded-md bg-accent/10 px-3 ring-1 ring-accent",
			)}
		>
			<div
				data-stacked={stacked ? "true" : undefined}
				className={cn(
					"flex",
					stacked ? "flex-col items-stretch gap-3" : "items-center justify-between gap-8",
				)}
			>
				<div className="flex min-w-0 flex-col">
					<div className="flex min-h-7 flex-wrap items-center gap-2">
						<p className="text-sm font-medium text-fg">{title}</p>
					</div>
					{description ? (
						<div id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
							{description}
						</div>
					) : null}
					{detail ? (
						<p
							className={cn(
								"mt-1 text-xs",
								detailTone === "warning" ? "text-warning-fg" : "text-fg-muted",
							)}
						>
							{detail}
						</p>
					) : null}
					{disabledReason ? <p className="text-xs text-fg-subtle">{disabledReason}</p> : null}
					{saveError ? (
						<p role="alert" className="text-xs text-danger">
							{saveError}
						</p>
					) : null}
					{onReset === undefined ? null : (
						<Menu>
							<MenuTrigger asChild>
								<button
									type="button"
									aria-label="Setting actions"
									className="absolute top-4 right-0 flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
								>
									<MoreHorizontalIcon className="size-4" />
								</button>
							</MenuTrigger>
							<MenuContent align="end">
								<MenuItem onSelect={() => onReset()}>{resetLabel}</MenuItem>
							</MenuContent>
						</Menu>
					)}
				</div>
				<fieldset
					disabled={disabledReason !== null}
					aria-describedby={description ? descriptionId : undefined}
					className={cn("flex items-center gap-2 border-0 p-0", stacked ? "w-full" : "shrink-0")}
				>
					<legend className="sr-only">{title}</legend>
					{withDisabled(children, disabledReason !== null)}
				</fieldset>
			</div>
		</div>
	);
}

/**
 * Tells the user a setting was not saved, in a toast, as Conductor's settings writer does.
 * `overwrite` repeats the save over an invalid file, for the toast's "Overwrite file" button.
 */
export function toastSettingSaveFailed(error: AppError, overwrite: OverwriteAndSave): void {
	tellSettingSaveFailed(error, overwrite, (shown) => {
		toast.error(shown.title, {
			...(shown.description === null ? {} : { description: shown.description }),
			...(shown.action === null ? {} : { action: shown.action }),
		});
	});
}

/**
 * Saves one setting through the action table. A failed save is told in a toast only, as in
 * Conductor, whose settings rows show no line of their own for it (the owner's ruling, 2026-11-12:
 * "whatever conductor does").
 */
export function useSettingSaves() {
	const actions = useActions();

	const save = useCallback(
		async (key: string, value: unknown): Promise<boolean> => {
			const result = await actions.settings.set(key, value);
			if (!result.ok) {
				toastSettingSaveFailed(result.error, () =>
					actions.settings.set(key, value, { overwrite: true }),
				);
				return false;
			}
			return true;
		},
		[actions],
	);

	return { save };
}

/** Saves a field's value; true when it was stored. A field puts its stored value back on false. */
type SaveField<T> = (value: T) => Promise<boolean>;

function NumberField({
	def,
	value,
	disabled,
	onChange,
}: {
	def: SettingDef;
	value: SettingValue;
	disabled: boolean;
	onChange: SaveField<number>;
}) {
	const initial = typeof value === "number" ? value : def.type === "number" ? def.default : 0;
	const [text, setText] = useState(String(initial));
	useEffect(() => {
		setText(String(initial));
	}, [initial]);
	return (
		<Input
			type="number"
			aria-label={def.title}
			value={text}
			min={def.type === "number" ? def.min : undefined}
			max={def.type === "number" ? def.max : undefined}
			disabled={disabled}
			className="w-32 text-right"
			onChange={(event) => setText(event.target.value)}
			onBlur={() => {
				const trimmed = text.trim();
				if (trimmed === "") return;
				const parsed = Number(trimmed);
				if (!Number.isFinite(parsed)) return;
				void onChange(parsed).then((saved) => {
					if (!saved) setText(String(initial));
				});
			}}
		/>
	);
}

function TextField({
	def,
	value,
	disabled,
	onChange,
}: {
	def: SettingDef;
	value: SettingValue;
	disabled: boolean;
	onChange: SaveField<string>;
}) {
	const initial = typeof value === "string" ? value : def.type === "string" ? def.default : "";
	const [text, setText] = useState(initial);
	useEffect(() => {
		setText(typeof value === "string" ? value : initial);
	}, [value, initial]);
	return (
		<>
			<Label htmlFor={`setting-control-${def.key}`} className="sr-only">
				{def.title}
			</Label>
			<Input
				id={`setting-control-${def.key}`}
				value={text}
				disabled={disabled}
				className="w-64"
				onChange={(event) => setText(event.target.value)}
				onBlur={() => {
					if (text === initial) return;
					void onChange(text).then((saved) => {
						if (!saved) setText(initial);
					});
				}}
			/>
		</>
	);
}

function ListField({
	def,
	value,
	disabled,
	onChange,
}: {
	def: SettingDef;
	value: SettingValue;
	disabled: boolean;
	onChange: SaveField<string[]>;
}) {
	const saved = Array.isArray(value) ? value.join("\n") : "";
	const [text, setText] = useState(saved);
	useEffect(() => {
		setText(Array.isArray(value) ? value.join("\n") : "");
	}, [value]);
	return (
		<>
			<Label htmlFor={`setting-control-${def.key}`} className="sr-only">
				{def.title}
			</Label>
			<Textarea
				id={`setting-control-${def.key}`}
				value={text}
				disabled={disabled}
				className="w-72 font-mono text-xs"
				onChange={(event) => setText(event.target.value)}
				onBlur={() => {
					if (text === saved) return;
					const lines = text
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line !== "");
					void onChange(lines).then((stored) => {
						if (!stored) setText(saved);
					});
				}}
			/>
		</>
	);
}

/** The control for one registry setting, chosen from its declared type. */
export function SettingControl({
	def,
	value,
	disabled = false,
	selectClassName = "w-[186px]",
	onChange,
}: {
	def: SettingDef;
	value: unknown;
	disabled?: boolean;
	selectClassName?: string;
	onChange: SaveField<SettingValue>;
}) {
	if (def.type === "bool") {
		// A key that says the opposite of its title (`graphite_disabled`, "Graphite stack support")
		// is shown and saved inverted.
		const inverted = def.shownInverted === true;
		return (
			<Switch
				aria-label={def.title}
				checked={inverted ? value !== true : value === true}
				disabled={disabled}
				onCheckedChange={(checked) => void onChange(inverted ? !checked : checked)}
			/>
		);
	}
	if (def.type === "enum") {
		return (
			<Select
				aria-label={def.title}
				value={typeof value === "string" ? value : def.default}
				options={def.options}
				disabled={disabled}
				className={selectClassName}
				onValueChange={(next) => void onChange(next)}
			/>
		);
	}
	if (def.type === "number") {
		return (
			<NumberField
				def={def}
				value={value as SettingValue}
				disabled={disabled}
				onChange={onChange}
			/>
		);
	}
	if (def.type === "string-list") {
		return (
			<ListField def={def} value={value as SettingValue} disabled={disabled} onChange={onChange} />
		);
	}
	return (
		<TextField def={def} value={value as SettingValue} disabled={disabled} onChange={onChange} />
	);
}

/** The row's description, followed by "Learn more" when the registry names a page for it. */
function describedWithLink(def: SettingDef): ReactNode {
	const text = pageDescriptionOf(def);
	if (def.learnMoreUrl === undefined) return text;
	return (
		<>
			{text}{" "}
			<ExternalLink url={def.learnMoreUrl} title="Learn more" className="underline hover:text-fg">
				Learn more
			</ExternalLink>
		</>
	);
}

/** How a page lays out one registry row where Conductor's page component differs from the plain row. */
export interface RowLayout {
	/** The description with its link, in place of the registry's plain text. */
	description?: ReactNode;
	/** The control under the text, as Conductor's "Open pull requests in" sits. */
	stacked?: boolean;
	/** The width class of a select, where Conductor's differs from the usual 186 px. */
	selectClassName?: string;
}

function RegistrySettingRow({
	def,
	focusSettingKey,
	beforeSave,
	extraFor,
	unavailableFor,
	layoutFor,
	saves,
}: {
	def: SettingDef;
	focusSettingKey: string | null;
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
	unavailableFor?: (def: SettingDef) => ReactNode | null;
	layoutFor?: (def: SettingDef) => RowLayout | null;
	saves: ReturnType<typeof useSettingSaves>;
}) {
	const layout = layoutFor?.(def) ?? null;
	const stored = useSetting<SettingValue>(def.key);
	const actions = useActions();
	const { services } = useServices();
	// Conductor's row actions menu appears only when the setting is set in the current scope.
	const configured = useStore(
		services.settings.store,
		(state) => state.values[def.key] !== undefined,
	);
	const unavailable = unavailableFor?.(def) ?? null;
	// Conductor's Reset removes a file-backed setting through its settings writer, which tells a
	// failure itself, with "Overwrite file" for an invalid file (deleteSetting, main @410879). Its
	// "Failed to reset setting" is for a reset that throws (renderApp @8734713), as a table row's
	// failed delete does.
	const reset = async () => {
		const result = await actions.settings.reset(def.key);
		if (result.ok) return;
		if (def.tomlKey === undefined) {
			toastError("Failed to reset setting", result.error);
			return;
		}
		toastSettingSaveFailed(result.error, () =>
			actions.settings.reset(def.key, { overwrite: true }),
		);
	};
	// A switch whose feature cannot run reads off, whatever is stored (Conductor's Graphite row).
	const value = unavailable !== null && def.type === "bool" ? def.shownInverted === true : stored;
	const [localError, setLocalError] = useState<string | null>(null);

	const handleChange = async (next: SettingValue): Promise<boolean> => {
		setLocalError(null);
		if (beforeSave !== undefined) {
			const problem = await beforeSave(def, next);
			if (problem !== null) {
				setLocalError(problem);
				return false;
			}
		}
		return saves.save(def.key, next);
	};

	return (
		<SettingRow
			settingKey={def.key}
			title={def.title}
			description={layout?.description ?? describedWithLink(def)}
			stacked={layout?.stacked === true}
			detail={def.detail ?? null}
			{...(def.detailTone === undefined ? {} : { detailTone: def.detailTone })}
			disabledReason={unavailable}
			highlighted={focusSettingKey === def.key}
			saveError={localError}
			{...(configured ? { onReset: () => void reset() } : {})}
		>
			<SettingControl
				def={def}
				value={value}
				onChange={handleChange}
				{...(layout?.selectClassName === undefined
					? {}
					: { selectClassName: layout.selectClassName })}
			/>
			{extraFor === undefined ? null : extraFor(def, value)}
		</SettingRow>
	);
}

export interface RegistrySettingRowsProps {
	page: SettingPage;
	focusSettingKey?: string | null;
	exclude?: readonly string[];
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
	/** Why a setting cannot change now (a program it needs is missing), or null when it can. */
	unavailableFor?: (def: SettingDef) => ReactNode | null;
	/** Where a row's layout follows Conductor's page component rather than the plain row. */
	layoutFor?: (def: SettingDef) => RowLayout | null;
}

/** Every setting of one registry page, with its control and save state. */
export function RegistrySettingRows({
	page,
	focusSettingKey = null,
	exclude = [],
	beforeSave,
	extraFor,
	unavailableFor,
	layoutFor,
}: RegistrySettingRowsProps) {
	const saves = useSettingSaves();
	return (
		<>
			{settingsForPage(page)
				.filter((def) => !exclude.includes(def.key))
				.map((def) => (
					<RegistrySettingRow
						key={def.key}
						def={def}
						focusSettingKey={focusSettingKey}
						beforeSave={beforeSave}
						extraFor={extraFor}
						unavailableFor={unavailableFor}
						layoutFor={layoutFor}
						saves={saves}
					/>
				))}
		</>
	);
}

/** One registry row by key, for a page that groups rows from several registry pages. */
export function RegistrySettingRowByKey({
	settingKey,
	focusSettingKey = null,
	beforeSave,
	extraFor,
	layout,
}: {
	settingKey: string;
	focusSettingKey?: string | null;
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
	layout?: RowLayout;
}) {
	const def = getSettingDef(settingKey);
	const saves = useSettingSaves();
	if (def === undefined) return null;
	return (
		<RegistrySettingRow
			def={def}
			focusSettingKey={focusSettingKey}
			beforeSave={beforeSave}
			extraFor={extraFor}
			layoutFor={layout === undefined ? undefined : () => layout}
			saves={saves}
		/>
	);
}
