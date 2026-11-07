/**
 * @feature SET-02 Setting row and setting controls
 * Owns: the layout of one setting (title, description, scope marker, reset action and the control
 * on the right), the control for a registry setting, and the save state pages share.
 * Behaviour: ui-map.md 6 (each setting has a title, a description and scopes user or repository;
 * per-repository settings offer a reset to the shared file's value).
 * Our design choice: the control is passed in as children, so one row serves toggles, selects,
 * text fields and custom blocks. `RegistrySettingRows` renders a page's settings from the registry
 * so every page uses one control implementation.
 * Must handle: a long description (wraps, no truncation), a switch whose stored key says the
 * opposite of its title (shown and saved inverted), a disabled setting with a reason (the
 * fieldset disables the control), a setting that is highlighted after a search jump, and a save
 * error line when saving fails (a typed number, text or list that was not saved goes back to the
 * stored value, so the field never shows a value the app does not hold).
 * Test first: with a disabledReason the control is disabled and the reason is shown.
 */
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
import { useActions, useSetting } from "../../core/hooks.ts";
import {
	getSettingDef,
	type SettingDef,
	type SettingPage,
	type SettingValue,
	settingsForPage,
} from "../../core/registries/settings.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Input, Label, Textarea } from "../../ui/Input.tsx";
import { Select } from "../../ui/Select.tsx";
import { Switch } from "../../ui/Switch.tsx";

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
	description: string | null;
	/** A small hint under the description. */
	detail?: string | null;
	/** "warning" draws the detail in the warning colour. */
	detailTone?: "warning";
	scope: "user" | "repo";
	/** Why the control cannot change now. Set, it disables the control and shows under the text. */
	disabledReason: ReactNode | null;
	highlighted: boolean;
	saveError: string | null;
	/** Shown when a repository value overrides the user value, with a way back. */
	onResetToShared?: () => void;
	children: ReactNode;
}

export function SettingRow({
	settingKey,
	title,
	description,
	detail = null,
	detailTone,
	scope,
	disabledReason,
	highlighted,
	saveError,
	onResetToShared,
	children,
}: SettingRowProps) {
	const descriptionId = `setting-${settingKey}-description`;
	return (
		<div
			id={`setting-${settingKey}`}
			data-setting-key={settingKey}
			data-highlighted={highlighted ? "true" : undefined}
			className={cn(
				"flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0",
				highlighted && "rounded-md bg-accent/10 px-3 ring-1 ring-accent",
			)}
		>
			<div className="flex items-center justify-between gap-8">
				<div className="flex min-w-0 flex-col">
					<div className="flex min-h-7 flex-wrap items-center gap-2">
						<p className="text-sm font-medium text-fg">{title}</p>
						<span className="rounded-sm border border-border px-1.5 py-0.5 text-3xs text-fg-subtle">
							{scope === "repo" ? "Repository" : "User"}
						</span>
					</div>
					{description ? (
						<p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
							{description}
						</p>
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
					{onResetToShared ? (
						<Button variant="link" size="sm" className="self-start" onClick={onResetToShared}>
							Reset to shared settings
						</Button>
					) : null}
				</div>
				<fieldset
					disabled={disabledReason !== null}
					aria-describedby={description ? descriptionId : undefined}
					className="flex shrink-0 items-center gap-2 border-0 p-0"
				>
					<legend className="sr-only">{title}</legend>
					{withDisabled(children, disabledReason !== null)}
				</fieldset>
			</div>
		</div>
	);
}

/** Saves one setting through the action table and keeps the failure text for its row. */
export function useSettingSaves() {
	const actions = useActions();
	const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({});

	const save = useCallback(
		async (key: string, value: unknown): Promise<boolean> => {
			setErrors((current) => ({ ...current, [key]: null }));
			const result = await actions.settings.set(key, value);
			if (!result.ok) {
				setErrors((current) => ({ ...current, [key]: result.error.message }));
				return false;
			}
			return true;
		},
		[actions],
	);

	const errorOf = useCallback((key: string) => errors[key] ?? null, [errors]);
	return { save, errorOf };
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
	onChange,
}: {
	def: SettingDef;
	value: unknown;
	disabled?: boolean;
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
				className="w-[186px]"
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

function RegistrySettingRow({
	def,
	focusSettingKey,
	beforeSave,
	extraFor,
	unavailableFor,
	saves,
}: {
	def: SettingDef;
	focusSettingKey: string | null;
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
	unavailableFor?: (def: SettingDef) => ReactNode | null;
	saves: ReturnType<typeof useSettingSaves>;
}) {
	const stored = useSetting<SettingValue>(def.key);
	const unavailable = unavailableFor?.(def) ?? null;
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
			description={def.description}
			detail={def.detail ?? null}
			{...(def.detailTone === undefined ? {} : { detailTone: def.detailTone })}
			scope={def.scopes.includes("repo") ? "repo" : "user"}
			disabledReason={unavailable}
			highlighted={focusSettingKey === def.key}
			saveError={localError ?? saves.errorOf(def.key)}
		>
			<SettingControl def={def} value={value} onChange={handleChange} />
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
}

/** Every setting of one registry page, with its control and save state. */
export function RegistrySettingRows({
	page,
	focusSettingKey = null,
	exclude = [],
	beforeSave,
	extraFor,
	unavailableFor,
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
}: {
	settingKey: string;
	focusSettingKey?: string | null;
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
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
			saves={saves}
		/>
	);
}
