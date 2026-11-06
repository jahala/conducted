/**
 * @feature SET-09 Agent provider keys
 * Owns: the Providers dialog and its Custom provider form on the Agents page. It chooses an agent's
 * provider, collects its key (or the choice to use the key from this Mac), the Amazon Bedrock
 * credentials, the Vertex project, the Codex ChatGPT account and a custom provider's optional
 * workspace ID, then saves or removes them through Actions.agents.
 * Behaviour: ui-map.md 6, "Agents page" (Claude Code subscription token, Anthropic API key and "Use
 * the key from this Mac", Amazon Bedrock with a Bedrock API key or AWS access keys, Codex API key or
 * ChatGPT account, Cursor API key, Custom provider with an optional workspace ID); ui-map.md 5.2
 * (the Providers and Custom provider dialogs); services-map.md 4.2.8 (provider keys); D033 (keys
 * reach only their own agent).
 * Data: useProviderKeys(agent, acpAgent), useSetting(claude_provider or codex_provider),
 * useActions().agents.setProviderKey and removeProviderKey, and Actions.settings for the Bedrock
 * region and Vertex project.
 * Must handle: a key already saved (shown as configured, never its value), saving over one key,
 * removing a key, "use the key from this Mac" (the sidecar reads it from the login shell), a missing
 * required Bedrock field, the region included ("Enter all required Bedrock fields."), Bedrock
 * credentials of the other mode left from an earlier save (removed), a saved test model the user
 * removes, a failed save or removal (shown and toasted, never shown as saved; a save of several parts
 * stops at the first failure), a provider with no key yet, and a custom provider without a workspace
 * ID.
 * Our design choice: the subscription token is saved under the Anthropic provider because both sign
 * Claude Code in; the Bedrock test model is saved as `ANTHROPIC_MODEL`; a custom workspace ID is
 * saved as the workspace variable its agent family uses.
 * Test first: saving an Anthropic key stores it in the Keychain and removing it deletes the entry.
 */
import type { AgentInstall } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useActions, useProviderKeys, useSetting } from "../../../core/hooks.ts";
import type { ProviderKeyView } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import {
	initialProviderChoice,
	keyEnvVarFor,
	type ProviderChoiceId,
	providerChoices,
	providerIdFor,
	providerSettingKey,
	workspaceIdEnvVarFor,
} from "./provider-forms.ts";

interface KeyRef {
	agent: AgentKind;
	acpAgent: AcpAgent | null;
	provider: string;
	envVar: string;
}

interface KeyFormProps {
	agent: AgentKind;
	acpAgent: AcpAgent | null;
	provider: string;
	envVar: string;
	label: string;
	description: string;
	keys: readonly ProviderKeyView[];
	onSave: (key: KeyRef, value: string | null, fromMac: boolean) => Promise<void>;
	onRemove: (key: KeyRef) => Promise<void>;
}

const hasKey = (keys: readonly ProviderKeyView[], provider: string, envVar: string): boolean =>
	keys.some((key) => key.provider === provider && key.envVar === envVar);

/** One key field, with "Use the key from this Mac" and its Save and Remove actions. */
function KeyForm({
	agent,
	acpAgent,
	provider,
	envVar,
	label,
	description,
	keys,
	onSave,
	onRemove,
}: KeyFormProps) {
	const saved = keys.find((key) => key.provider === provider && key.envVar === envVar);
	const [value, setValue] = useState("");
	const [fromMac, setFromMac] = useState(saved?.source === "this_mac");
	const [busy, setBusy] = useState(false);
	const id = `${agent}-${provider}-${envVar}`;

	const save = async () => {
		setBusy(true);
		await onSave(
			{ agent, acpAgent, provider, envVar },
			value.trim() === "" ? null : value,
			fromMac,
		);
		setBusy(false);
	};
	const remove = async () => {
		setBusy(true);
		await onRemove({ agent, acpAgent, provider, envVar });
		setValue("");
		setBusy(false);
	};

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<p className="text-sm text-fg-muted">{description}</p>
			<div className="flex flex-wrap items-end gap-2">
				<Input
					id={id}
					type="password"
					autoComplete="off"
					value={value}
					placeholder={saved ? "Saved. Enter a new key to replace it." : "Paste the key"}
					className="w-80"
					onChange={(event) => setValue(event.target.value)}
				/>
				<Button variant="secondary" loading={busy} onClick={() => void save()}>
					Save key
				</Button>
				{saved ? (
					<Button variant="outlineDestructive" disabled={busy} onClick={() => void remove()}>
						Remove key
					</Button>
				) : null}
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id={`${id}-from-mac`}
					checked={fromMac}
					onCheckedChange={(checked) => setFromMac(checked)}
				/>
				<Label htmlFor={`${id}-from-mac`}>Use the key from this Mac</Label>
			</div>
			{saved ? (
				<p className="text-xs text-fg-muted">
					{saved.source === "this_mac"
						? "Using the key from this Mac's environment."
						: "A key is saved for this provider."}
				</p>
			) : null}
		</div>
	);
}

interface BedrockFormProps {
	agent: AgentKind;
	keys: readonly ProviderKeyView[];
	region: string;
	/**
	 * Saves the credentials of the chosen mode and removes `remove`: the other mode's variables, and the
	 * test model when its field was cleared. Resolves true when everything was saved.
	 */
	onSave: (
		entries: readonly { envVar: string; value: string }[],
		remove: readonly string[],
		region: string,
	) => Promise<boolean>;
	onRemove: (keys: readonly string[]) => Promise<void>;
}

const BEDROCK_API_KEY_VARS = ["AWS_BEARER_TOKEN_BEDROCK"] as const;
const BEDROCK_ACCESS_KEY_VARS = [
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
] as const;
const BEDROCK_TEST_MODEL_VAR = "ANTHROPIC_MODEL";

/**
 * Amazon Bedrock: one Bedrock API key, or AWS access keys with an optional session token, the region and
 * an optional test model. Saving one mode removes the other mode's credentials, because the AWS SDK
 * prefers a Bedrock API key over access keys and an old one would win. The region is required: Claude Code
 * reads it from `AWS_REGION` and does not take it from the AWS profile.
 */
function BedrockForm({ agent, keys, region, onSave, onRemove }: BedrockFormProps) {
	const [mode, setMode] = useState<"api_key" | "access_keys">(
		hasKey(keys, "bedrock", "AWS_ACCESS_KEY_ID") ? "access_keys" : "api_key",
	);
	const [apiKey, setApiKey] = useState("");
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretKey, setSecretKey] = useState("");
	const [sessionToken, setSessionToken] = useState("");
	const [testModel, setTestModel] = useState("");
	const [clearTestModel, setClearTestModel] = useState(false);
	const [regionValue, setRegionValue] = useState(region);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const testModelSaved = hasKey(keys, "bedrock", BEDROCK_TEST_MODEL_VAR);

	const save = async () => {
		const entries: { envVar: string; value: string }[] = [];
		const remove: string[] = [];
		if (regionValue.trim() === "") {
			setError("Enter all required Bedrock fields.");
			return;
		}
		if (mode === "api_key") {
			if (apiKey.trim() === "") {
				setError("Enter all required Bedrock fields.");
				return;
			}
			entries.push({ envVar: "AWS_BEARER_TOKEN_BEDROCK", value: apiKey.trim() });
			remove.push(...BEDROCK_ACCESS_KEY_VARS.filter((envVar) => hasKey(keys, "bedrock", envVar)));
		} else {
			if (accessKeyId.trim() === "" || secretKey.trim() === "") {
				setError("Enter all required Bedrock fields.");
				return;
			}
			entries.push({ envVar: "AWS_ACCESS_KEY_ID", value: accessKeyId.trim() });
			entries.push({ envVar: "AWS_SECRET_ACCESS_KEY", value: secretKey.trim() });
			if (sessionToken.trim() !== "") {
				entries.push({ envVar: "AWS_SESSION_TOKEN", value: sessionToken.trim() });
			} else if (hasKey(keys, "bedrock", "AWS_SESSION_TOKEN")) {
				remove.push("AWS_SESSION_TOKEN");
			}
			remove.push(...BEDROCK_API_KEY_VARS.filter((envVar) => hasKey(keys, "bedrock", envVar)));
		}
		if (testModel.trim() !== "") {
			entries.push({ envVar: BEDROCK_TEST_MODEL_VAR, value: testModel.trim() });
		} else if (clearTestModel && testModelSaved) {
			remove.push(BEDROCK_TEST_MODEL_VAR);
		}
		setError(null);
		setBusy(true);
		const saved = await onSave(entries, remove, regionValue.trim());
		setBusy(false);
		if (saved) setClearTestModel(false);
	};

	const remove = async () => {
		setBusy(true);
		await onRemove([...BEDROCK_API_KEY_VARS, ...BEDROCK_ACCESS_KEY_VARS, BEDROCK_TEST_MODEL_VAR]);
		setBusy(false);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${agent}-bedrock-mode`}>Credentials</Label>
				<Select
					id={`${agent}-bedrock-mode`}
					aria-label="Bedrock credentials"
					value={mode}
					options={[
						{ value: "api_key", label: "Bedrock API key" },
						{ value: "access_keys", label: "AWS access keys" },
					]}
					onValueChange={(next) => setMode(next)}
				/>
			</div>
			{mode === "api_key" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${agent}-bedrock-api-key`}>Bedrock API key</Label>
					<Input
						id={`${agent}-bedrock-api-key`}
						type="password"
						autoComplete="off"
						value={apiKey}
						className="w-80"
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</div>
			) : (
				<div className="flex flex-wrap gap-3">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${agent}-aws-access-key`}>Access key ID</Label>
						<Input
							id={`${agent}-aws-access-key`}
							autoComplete="off"
							value={accessKeyId}
							className="w-64"
							onChange={(event) => setAccessKeyId(event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${agent}-aws-secret-key`}>Secret access key</Label>
						<Input
							id={`${agent}-aws-secret-key`}
							type="password"
							autoComplete="off"
							value={secretKey}
							className="w-64"
							onChange={(event) => setSecretKey(event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${agent}-aws-session-token`}>Session token (optional)</Label>
						<Input
							id={`${agent}-aws-session-token`}
							type="password"
							autoComplete="off"
							value={sessionToken}
							className="w-64"
							onChange={(event) => setSessionToken(event.target.value)}
						/>
					</div>
				</div>
			)}
			<div className="flex flex-wrap gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${agent}-bedrock-region`}>Region</Label>
					<Input
						id={`${agent}-bedrock-region`}
						value={regionValue}
						placeholder="us-east-1"
						className="w-48"
						onChange={(event) => setRegionValue(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${agent}-bedrock-test-model`}>Test model</Label>
					<Input
						id={`${agent}-bedrock-test-model`}
						value={testModel}
						placeholder={
							testModelSaved && !clearTestModel
								? "Saved. Enter a new model to replace it."
								: "For example, a Claude model id"
						}
						className="w-64"
						onChange={(event) => setTestModel(event.target.value)}
					/>
				</div>
			</div>
			{testModelSaved ? (
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${agent}-bedrock-clear-test-model`}
						checked={clearTestModel}
						onCheckedChange={(checked) => setClearTestModel(checked)}
					/>
					<Label htmlFor={`${agent}-bedrock-clear-test-model`}>
						Remove the saved test model on save
					</Label>
				</div>
			) : null}
			{error ? (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button variant="secondary" loading={busy} onClick={() => void save()}>
					Save Bedrock credentials
				</Button>
				{keys.some((key) => key.provider === "bedrock") ? (
					<Button variant="outlineDestructive" disabled={busy} onClick={() => void remove()}>
						Remove credentials
					</Button>
				) : null}
			</div>
		</div>
	);
}

interface VertexFormProps {
	agent: AgentKind;
	project: string;
	onSave: (project: string, credentials: string | null) => Promise<void>;
}

/** Google Vertex AI: the project and the application credentials file. */
function VertexForm({ agent, project, onSave }: VertexFormProps) {
	const [projectValue, setProjectValue] = useState(project);
	const [credentials, setCredentials] = useState("");
	const [busy, setBusy] = useState(false);

	const save = async () => {
		setBusy(true);
		await onSave(projectValue.trim(), credentials.trim() === "" ? null : credentials);
		setBusy(false);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${agent}-vertex-project`}>Vertex project</Label>
				<Input
					id={`${agent}-vertex-project`}
					value={projectValue}
					placeholder="Google Cloud project id"
					className="w-80"
					onChange={(event) => setProjectValue(event.target.value)}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${agent}-vertex-credentials`}>Application credentials</Label>
				<Input
					id={`${agent}-vertex-credentials`}
					value={credentials}
					placeholder="Path to the credentials file, or leave as is"
					className="w-96"
					onChange={(event) => setCredentials(event.target.value)}
				/>
			</div>
			<Button variant="secondary" loading={busy} onClick={() => void save()}>
				Save Vertex settings
			</Button>
		</div>
	);
}

interface CustomFormProps {
	agent: AgentKind;
	acpAgent: AcpAgent | null;
	keys: readonly ProviderKeyView[];
	onSave: (
		key: KeyRef,
		value: string | null,
		workspaceId: string,
		workspaceEnvVar: string,
	) => Promise<void>;
	onRemove: (keys: KeyRef[]) => Promise<void>;
}

/** Custom provider: the key and an optional workspace ID. */
function CustomForm({ agent, acpAgent, keys, onSave, onRemove }: CustomFormProps) {
	const provider = "custom";
	const keyEnvVar = keyEnvVarFor(agent, "custom");
	const workspaceEnvVar = workspaceIdEnvVarFor(agent);
	const [value, setValue] = useState("");
	const [workspaceId, setWorkspaceId] = useState("");
	const [busy, setBusy] = useState(false);

	const save = async () => {
		setBusy(true);
		await onSave(
			{ agent, acpAgent, provider, envVar: keyEnvVar },
			value.trim() === "" ? null : value,
			workspaceId.trim(),
			workspaceEnvVar,
		);
		setBusy(false);
	};
	const remove = async () => {
		setBusy(true);
		await onRemove([
			{ agent, acpAgent, provider, envVar: keyEnvVar },
			{ agent, acpAgent, provider, envVar: workspaceEnvVar },
		]);
		setBusy(false);
	};
	const saved = keys.find((key) => key.provider === provider && key.envVar === keyEnvVar);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${agent}-custom-key`}>API key</Label>
				<Input
					id={`${agent}-custom-key`}
					type="password"
					autoComplete="off"
					value={value}
					placeholder={saved ? "Saved. Enter a new key to replace it." : "Paste the key"}
					className="w-80"
					onChange={(event) => setValue(event.target.value)}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${agent}-custom-workspace`}>Workspace ID (optional)</Label>
				<Input
					id={`${agent}-custom-workspace`}
					value={workspaceId}
					placeholder="Optional"
					className="w-64"
					onChange={(event) => setWorkspaceId(event.target.value)}
				/>
			</div>
			<div className="flex gap-2">
				<Button variant="secondary" loading={busy} onClick={() => void save()}>
					Save key
				</Button>
				{keys.some((key) => key.provider === provider) ? (
					<Button variant="outlineDestructive" disabled={busy} onClick={() => void remove()}>
						Remove key
					</Button>
				) : null}
			</div>
		</div>
	);
}

export interface AgentProvidersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	install: AgentInstall;
	/** Starts the agent's own sign-in flow, for the Codex ChatGPT account. */
	onSignIn: () => void;
}

export function AgentProvidersDialog({
	open,
	onOpenChange,
	install,
	onSignIn,
}: AgentProvidersDialogProps) {
	const actions = useActions();
	const agent = install.agent;
	const acpAgent = install.acpAgent ?? null;
	const settingKey = providerSettingKey(agent);
	const setting = useSetting<string>(settingKey ?? "");
	const keys = useProviderKeys(agent, install.acpAgent);
	const choices = providerChoices(agent, install.acpAgent);
	const [selected, setSelected] = useState<ProviderChoiceId | null>(null);
	const [busy, setBusy] = useState(false);
	const bedrockRegion = useSetting<string>("bedrock_region");
	const vertexProject = useSetting<string>("vertex_project_id");

	useEffect(() => {
		if (!open) setSelected(null);
	}, [open]);

	const saved = keys.state === "ready" ? keys.data : [];
	const choice = selected ?? initialProviderChoice(agent, settingKey === null ? null : setting);
	const current = choices.find((entry) => entry.id === choice) ?? choices[0];

	const choose = (id: ProviderChoiceId) => {
		setSelected(id);
		const next = choices.find((entry) => entry.id === id);
		if (settingKey !== null && next !== undefined && next.settingValue !== null) {
			void actions.settings.set(settingKey, next.settingValue).then((result) => {
				if (!result.ok) toastError("Couldn't save the provider choice", result.error);
			});
		}
	};

	const saveKey = async (key: KeyRef, value: string | null, fromMac: boolean): Promise<void> => {
		setBusy(true);
		const result = await actions.agents.setProviderKey(
			key,
			fromMac ? { kind: "this_mac" } : { kind: "entered", value: value ?? "" },
		);
		setBusy(false);
		if (!result.ok) {
			toastError("Couldn't save the API key", result.error);
			return;
		}
		toast(fromMac ? "API key imported from env" : "API key saved");
	};

	const removeKey = async (key: KeyRef): Promise<void> => {
		const result = await actions.agents.removeProviderKey(key);
		if (!result.ok) {
			toastError("Couldn't remove the API key", result.error);
			return;
		}
		toast("API key removed");
	};

	/** Saves each entry in order and stops at the first failure, which it shows. */
	const saveMany = async (
		provider: string,
		entries: readonly { envVar: string; value: string }[],
	): Promise<boolean> => {
		for (const entry of entries) {
			const result = await actions.agents.setProviderKey(
				{ agent, acpAgent, provider, envVar: entry.envVar },
				{ kind: "entered", value: entry.value },
			);
			if (!result.ok) {
				toastError("Couldn't save the API key", result.error);
				return false;
			}
		}
		return true;
	};

	/** Removes each variable in order and stops at the first failure, which it shows. */
	const removeEach = async (provider: string, envVars: readonly string[]): Promise<boolean> => {
		for (const envVar of envVars) {
			const result = await actions.agents.removeProviderKey({ agent, acpAgent, provider, envVar });
			if (!result.ok) {
				toastError("Couldn't remove the API key", result.error);
				return false;
			}
		}
		return true;
	};

	const removeMany = async (provider: string, envVars: readonly string[]): Promise<void> => {
		if (await removeEach(provider, envVars)) toast("API key removed");
	};

	/** Saves the Bedrock credentials, removes the stale ones, then the region. Stops at the first failure. */
	const saveBedrock = async (
		entries: readonly { envVar: string; value: string }[],
		remove: readonly string[],
		region: string,
	): Promise<boolean> => {
		setBusy(true);
		const saved =
			(await saveMany("bedrock", entries)) &&
			(await removeEach("bedrock", remove)) &&
			(await saveSetting("bedrock_region", region, "Couldn't save the Bedrock region"));
		setBusy(false);
		if (saved) toast("API key saved");
		return saved;
	};

	/** Saves the Vertex credentials, then the project. Stops at the first failure and reports one result. */
	const saveVertex = async (project: string, credentials: string | null): Promise<void> => {
		setBusy(true);
		const saved =
			(credentials === null ||
				(await saveMany("vertex", [
					{ envVar: "GOOGLE_APPLICATION_CREDENTIALS", value: credentials },
				]))) &&
			(await saveSetting("vertex_project_id", project, "Couldn't save the Vertex project"));
		setBusy(false);
		if (saved) toast("Vertex settings saved");
	};

	const saveSetting = async (key: string, value: string, failure: string): Promise<boolean> => {
		const result = await actions.settings.set(key, value);
		if (!result.ok) toastError(failure, result.error);
		return result.ok;
	};

	const saveCustom = async (
		key: KeyRef,
		value: string | null,
		workspaceId: string,
		workspaceEnvVar: string,
	): Promise<void> => {
		setBusy(true);
		const result = await actions.agents.setProviderKey(key, {
			kind: "entered",
			value: value ?? "",
		});
		if (!result.ok) {
			setBusy(false);
			toastError("Couldn't save the API key", result.error);
			return;
		}
		const workspace =
			workspaceId === ""
				? await actions.agents.removeProviderKey({
						agent,
						acpAgent,
						provider: key.provider,
						envVar: workspaceEnvVar,
					})
				: await actions.agents.setProviderKey(
						{ agent, acpAgent, provider: key.provider, envVar: workspaceEnvVar },
						{ kind: "entered", value: workspaceId },
					);
		if (!workspace.ok) {
			setBusy(false);
			toastError("Couldn't save the workspace ID", workspace.error);
			return;
		}
		setBusy(false);
		toast("API key saved");
	};

	const title = choice === "custom" ? "Custom provider" : "Providers";
	const envVar = keyEnvVarFor(agent, choice);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={title}
				description={
					choice === "custom"
						? `A custom provider for ${agentName(agent, acpAgent)}.`
						: `Provider sign-in and keys for ${agentName(agent, acpAgent)}.`
				}
			>
				<div className="flex flex-col gap-4">
					{choices.length > 1 ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={`${agent}-provider-choice`}>Provider</Label>
							<Select
								id={`${agent}-provider-choice`}
								aria-label="Provider"
								value={choice}
								options={choices.map((entry) => ({ value: entry.id, label: entry.label }))}
								onValueChange={(next) => choose(next)}
							/>
						</div>
					) : null}

					{keys.state === "error" ? (
						<p role="alert" className="text-sm text-danger">
							{keys.error.message}
						</p>
					) : null}

					{current?.id === "subscription" ? (
						<KeyForm
							key="subscription"
							agent={agent}
							acpAgent={acpAgent}
							provider={providerIdFor("subscription")}
							envVar="CLAUDE_CODE_OAUTH_TOKEN"
							label="Claude Code subscription token"
							description="Paste the token from claude setup-token. It is stored in the Keychain."
							keys={saved}
							onSave={saveKey}
							onRemove={removeKey}
						/>
					) : null}

					{current?.id === "anthropic" || current?.id === "openai" || current?.id === "cursor" ? (
						<KeyForm
							key={current.id}
							agent={agent}
							acpAgent={acpAgent}
							provider={providerIdFor(current.id)}
							envVar={envVar}
							label={
								current.id === "anthropic"
									? "Anthropic API key"
									: current.id === "openai"
										? "OpenAI API key"
										: "Cursor API key"
							}
							description="The key is stored in the Keychain and never shown again."
							keys={saved}
							onSave={saveKey}
							onRemove={removeKey}
						/>
					) : null}

					{current?.id === "chatgpt" ? (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-fg-muted">
								{install.authenticated === true && install.authMethod === "chatgpt"
									? "Codex is signed in with your ChatGPT plan."
									: "Sign in to Codex with your ChatGPT account, or choose OpenAI API key to enter a key."}
							</p>
							<Button variant="secondary" onClick={onSignIn}>
								Sign in with ChatGPT
							</Button>
						</div>
					) : null}

					{current?.id === "bedrock" ? (
						<BedrockForm
							agent={agent}
							keys={saved}
							region={bedrockRegion}
							onSave={saveBedrock}
							onRemove={(envVars) => removeMany("bedrock", envVars)}
						/>
					) : null}

					{current?.id === "vertex" ? (
						<VertexForm agent={agent} project={vertexProject} onSave={saveVertex} />
					) : null}

					{current?.id === "custom" ? (
						<CustomForm
							agent={agent}
							acpAgent={acpAgent}
							keys={saved}
							onSave={saveCustom}
							onRemove={async (refs) => {
								for (const ref of refs) await removeKey(ref);
							}}
						/>
					) : null}

					{busy ? <p className="text-xs text-fg-muted">Saving…</p> : null}
				</div>

				<div aria-hidden="true" className="text-xs text-fg-subtle">
					<p className="text-sm text-fg-muted">Keys are saved in the macOS Keychain.</p>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function agentName(agent: AgentKind, acpAgent: AcpAgent | null): string {
	if (agent === "claude") return "Claude Code";
	if (agent === "codex") return "Codex";
	if (agent === "cursor") return "Cursor";
	return acpAgent === "pi" ? "Pi" : "OpenCode";
}
