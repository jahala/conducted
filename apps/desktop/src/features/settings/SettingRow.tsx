/**
 * @feature SET-02 Setting row and setting controls
 * Owns: the layout of one setting (title, description, scope marker, reset action and the control
 * on the right), the control for a registry setting, and the save state pages share.
 * Behaviour: ui-map.md 6 (each setting has a title, a description and scopes user or repository;
 * per-repository settings offer a reset to the shared file's value).
 * Our design choice: the control is passed in as children, so one row serves toggles, selects,
 * text fields and custom blocks. `RegistrySettingRows` renders a page's settings from the registry
 * so every page uses one control implementation.
 * Must handle: a long description (wraps, no truncation), a disabled setting with a reason (the
 * fieldset disables the control), a setting that is highlighted after a search jump, and a save
 * error line when saving fails.
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
	scope: "user" | "repo";
	disabledReason: string | null;
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
				"flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0",
				highlighted && "rounded-md bg-accent/10 px-3 ring-1 ring-accent",
			)}
		>
			<div className="flex items-start justify-between gap-6">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-sm font-medium text-fg">{title}</p>
						<span className="rounded-sm border border-border px-1.5 py-0.5 text-3xs text-fg-subtle">
							{scope === "repo" ? "Repository" : "User"}
						</span>
					</div>
					{description ? (
						<p id={descriptionId} className="max-w-prose text-sm text-fg-muted">
							{description}
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
	const [saving, setSaving] = useState<Readonly<Record<string, boolean>>>({});

	const save = useCallback(
		async (key: string, value: unknown): Promise<boolean> => {
			setSaving((current) => ({ ...current, [key]: true }));
			setErrors((current) => ({ ...current, [key]: null }));
			const result = await actions.settings.set(key, value);
			setSaving((current) => ({ ...current, [key]: false }));
			if (!result.ok) {
				setErrors((current) => ({ ...current, [key]: result.error.message }));
				return false;
			}
			return true;
		},
		[actions],
	);

	const errorOf = useCallback((key: string) => errors[key] ?? null, [errors]);
	const savingOf = useCallback((key: string) => saving[key] === true, [saving]);
	return { save, errorOf, savingOf };
}

function NumberField({
	def,
	value,
	disabled,
	onChange,
}: {
	def: SettingDef;
	value: SettingValue;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	const initial = typeof value === "number" ? value : def.type === "number" ? def.default : 0;
	const [text, setText] = useState(String(initial));
	useEffect(() => {
		setText(String(typeof value === "number" ? value : initial));
	}, [value, initial]);
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
				if (Number.isFinite(parsed)) onChange(parsed);
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
	onChange: (value: string) => void;
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
					if (text !== initial) onChange(text);
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
	onChange: (value: string[]) => void;
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
					onChange(
						text
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line !== ""),
					);
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
	onChange: (value: SettingValue) => void;
}) {
	if (def.type === "bool") {
		return (
			<Switch
				aria-label={def.title}
				checked={value === true}
				disabled={disabled}
				onCheckedChange={(checked) => onChange(checked)}
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
				onValueChange={(next) => onChange(next)}
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
	saves,
}: {
	def: SettingDef;
	focusSettingKey: string | null;
	beforeSave?: (def: SettingDef, value: SettingValue) => Promise<string | null> | string | null;
	extraFor?: (def: SettingDef, value: SettingValue) => ReactNode;
	saves: ReturnType<typeof useSettingSaves>;
}) {
	const value = useSetting<SettingValue>(def.key);
	const [localError, setLocalError] = useState<string | null>(null);

	const handleChange = async (next: SettingValue) => {
		setLocalError(null);
		if (beforeSave !== undefined) {
			const problem = await beforeSave(def, next);
			if (problem !== null) {
				setLocalError(problem);
				return;
			}
		}
		await saves.save(def.key, next);
	};

	return (
		<SettingRow
			settingKey={def.key}
			title={def.title}
			description={def.description}
			scope={def.scopes.includes("repo") ? "repo" : "user"}
			disabledReason={null}
			highlighted={focusSettingKey === def.key}
			saveError={localError ?? saves.errorOf(def.key)}
		>
			<SettingControl def={def} value={value} onChange={(next) => void handleChange(next)} />
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
}

/** Every setting of one registry page, with its control and save state. */
export function RegistrySettingRows({
	page,
	focusSettingKey = null,
	exclude = [],
	beforeSave,
	extraFor,
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
