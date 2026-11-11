/**
 * @feature APP-17 Import from Conductor: the dry run and the import
 * @feature APP-18 Chat history from Conductor: what history comes, and what became of it
 * Owns: `ConductorImportDialog`, which runs the dry run when it opens, shows per kind what comes
 * over, what is already here and what stays behind with each reason, the script renames and the
 * script files the user changes by hand and which chats bring their history, then imports when
 * the user goes ahead and shows the outcome, naming each chat whose history did not come over; `ConductorImportRow`, its Settings row; and `ConductorImportOffer`, the first-run button.
 * Behaviour: docs/plans/migrate-from-conductor.md (safety rule 2: a dry run comes first; rule 6:
 * no value is shown). Conductor has no such control, so its place follows D098: the General page,
 * after Sync agent configs, which also brings things over from elsewhere, and the first project
 * step of onboarding, where a user arriving from Conductor starts (docs/design.md).
 * Must handle: the dry run loading, failing (with Try again) and finding nothing to bring; the
 * import running (the dialog cannot close mid-way), failing (the message says Conducted is as it
 * was) and finishing; closing the dialog drops the dry run and its copy.
 * Test first: the dialog shows the dry run's counts and imports when the user goes ahead.
 */
import { useEffect, useRef, useState } from "react";
import type {
	HistoryOutcome,
	HistoryPreview,
	ImportKind,
	ImportPreview,
	LeftOut,
} from "../../core/api.ts";
import { useActions, useConductorImport } from "../../core/hooks.ts";
import { Alert, AlertDescription } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

const KIND_LABEL: Readonly<Record<ImportKind, string>> = {
	repos: "Projects",
	workspaces: "Workspaces",
	chats: "Chats",
	reviewComments: "Review comments",
	sections: "Sidebar sections",
	favoriteModels: "Favorite models",
	settings: "Settings",
	environmentVariables: "Environment variables",
	scripts: "Repository scripts",
};

const KINDS = Object.keys(KIND_LABEL) as ImportKind[];

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** How many items of this preview come over, in all. */
const toImport = (preview: ImportPreview): number =>
	KINDS.reduce((total, kind) => total + preview.kinds[kind].toImport, 0);

function CountsTable({ preview }: { preview: ImportPreview }) {
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="text-left text-xs text-fg-muted">
					<th className="py-1.5 font-medium">In Conductor</th>
					<th className="py-1.5 text-right font-medium">Comes over</th>
					<th className="py-1.5 text-right font-medium">Already here</th>
					<th className="py-1.5 text-right font-medium">Stays behind</th>
				</tr>
			</thead>
			<tbody>
				{KINDS.filter((kind) => preview.kinds[kind].found > 0).map((kind) => {
					const count = preview.kinds[kind];
					return (
						<tr key={kind} className="border-t border-border">
							<td className="py-1.5 text-fg">{KIND_LABEL[kind]}</td>
							<td className="py-1.5 text-right font-medium text-fg tabular-nums">
								{count.toImport}
							</td>
							<td className="py-1.5 text-right text-fg-muted tabular-nums">{count.alreadyThere}</td>
							<td className="py-1.5 text-right text-fg-muted tabular-nums">{count.leftOut}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

/** Conductor's agents by the name the user knows them by. */
const AGENT_LABEL: Readonly<Record<string, string>> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	acp: "OpenCode and Pi",
	other: "Other agents",
};

const entries = (n: number): string =>
	`${n.toLocaleString("en-US")} ${n === 1 ? "entry" : "entries"}`;

/** Which chats bring their history, which already have it, and which come without it. */
function HistoryDetails({ history }: { history: HistoryPreview }) {
	const lines: { key: string; text: string; reason: string | null }[] = [];
	if (history.comes.chats > 0) {
		lines.push({
			key: "comes",
			text: `${count(history.comes.chats, "chat")} with ${history.comes.chats === 1 ? "its" : "their"} history (${entries(history.comes.rows)})`,
			reason: null,
		});
	}
	if (history.alreadyThere.chats > 0) {
		lines.push({
			key: "already",
			text: `${count(history.alreadyThere.chats, "chat")} already here with history or new turns`,
			reason: "Nothing is added to them.",
		});
	}
	for (const agent of history.notMapped) {
		lines.push({
			key: `agent:${agent.agent}`,
			text: `${AGENT_LABEL[agent.agent] ?? agent.agent}: ${count(agent.chats, "chat")} (${entries(agent.rows)})`,
			reason:
				"History not brought: no mapping for this agent yet. Each chat continues from the agent's own transcript.",
		});
	}
	if (history.withChatsLeftOut.chats > 0) {
		lines.push({
			key: "left",
			text: `${count(history.withChatsLeftOut.chats, "chat")} that stay behind (${entries(history.withChatsLeftOut.rows)})`,
			reason: "Their history stays with them in Conductor.",
		});
	}
	if (lines.length === 0) return null;
	return (
		<Section title="Chat history">
			<ul className="flex flex-col gap-2 text-sm">
				{lines.map((line) => (
					<li key={line.key} className="flex flex-col gap-0.5">
						<span className="text-fg">{line.text}</span>
						{line.reason === null ? null : <span className="text-fg-muted">{line.reason}</span>}
					</li>
				))}
			</ul>
		</Section>
	);
}

/** What became of the history: how many chats brought it, and each chat whose history failed. */
function HistoryResult({ history }: { history: HistoryOutcome }) {
	if (history.failed.length === 0 && history.changed === 0) return null;
	return (
		<div className="flex flex-col gap-2 text-sm">
			{history.changed > 0 ? (
				<p className="text-fg-muted">
					{count(history.changed, "chat")} gained new turns since the dry run, so nothing was added
					to {history.changed === 1 ? "it" : "them"}.
				</p>
			) : null}
			{history.failed.length > 0 ? (
				<Alert>
					<AlertDescription>
						<span className="font-medium">
							History not brought for {count(history.failed.length, "chat")}. Each came over without
							it and continues from the agent's own transcript.
						</span>
						<ul className="mt-1 flex flex-col gap-1">
							{history.failed.map((failure) => (
								<li key={failure.sessionId}>
									{failure.label}: {failure.reason}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}

/** Left-out items grouped by kind and reason, so a long list reads as a few lines. */
function groups(
	items: readonly LeftOut[],
): { kind: ImportKind; reason: string; labels: string[] }[] {
	const byKey = new Map<string, { kind: ImportKind; reason: string; labels: string[] }>();
	for (const item of items) {
		const key = `${item.kind}\u0000${item.reason}`;
		const group = byKey.get(key) ?? { kind: item.kind, reason: item.reason, labels: [] };
		group.labels.push(item.label);
		byKey.set(key, group);
	}
	return [...byKey.values()];
}

/** The first few names of a group; the rest are counted. */
const SHOWN_LABELS = 5;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-sm font-medium text-fg">{title}</h3>
			{children}
		</section>
	);
}

function PreviewDetails({ preview }: { preview: ImportPreview }) {
	const left = groups([...preview.leftOut, ...preview.parts]);
	const notBrought = preview.notBrought.filter((item) => item.count === null || item.count > 0);
	return (
		<div className="flex flex-col gap-5">
			<CountsTable preview={preview} />
			<HistoryDetails history={preview.history} />
			{left.length === 0 ? null : (
				<Section title="What stays behind">
					<ul className="flex flex-col gap-2 text-sm">
						{left.map((group) => (
							<li key={`${group.kind}:${group.reason}`} className="flex flex-col gap-0.5">
								<span className="text-fg">
									{KIND_LABEL[group.kind]}: {group.labels.slice(0, SHOWN_LABELS).join(", ")}
									{group.labels.length > SHOWN_LABELS
										? ` and ${group.labels.length - SHOWN_LABELS} more`
										: ""}
								</span>
								<span className="text-fg-muted">{group.reason}</span>
							</li>
						))}
					</ul>
				</Section>
			)}
			{notBrought.length === 0 ? null : (
				<Section title="Not brought over">
					<ul className="flex flex-col gap-2 text-sm">
						{notBrought.map((item) => (
							<li key={item.what} className="flex flex-col gap-0.5">
								<span className="text-fg">
									{item.count === null ? item.what : `${item.what} (${item.count})`}
								</span>
								<span className="text-fg-muted">{item.reason}</span>
							</li>
						))}
					</ul>
				</Section>
			)}
			{preview.renames.length === 0 ? null : (
				<Section title="Renamed in the scripts it copies">
					<ul className="flex flex-col gap-1 text-sm">
						{preview.renames.map((rename) => (
							<li key={`${rename.repoName}:${rename.file}:${rename.from}`} className="text-fg">
								{rename.repoName}, {rename.file}:{" "}
								<code className="font-mono text-xs">{rename.from}</code> becomes{" "}
								<code className="font-mono text-xs">{rename.to}</code>
								{rename.setByConducted ? null : (
									<span className="text-fg-muted"> (Conducted does not set this variable)</span>
								)}
							</li>
						))}
					</ul>
				</Section>
			)}
			{preview.scriptMentions.length === 0 ? null : (
				<Section title="Script files to change yourself">
					<p className="text-sm text-fg-muted">
						These files are yours, so the import leaves them as they are. Conducted sets only
						CONDUCTED_ names.
					</p>
					<ul className="flex flex-col gap-1 text-sm">
						{preview.scriptMentions.map((mention) => (
							<li
								key={`${mention.repoName}:${mention.file}:${mention.line}:${mention.name}`}
								className="text-fg"
							>
								{mention.repoName}, {mention.file} line {mention.line}: use{" "}
								<code className="font-mono text-xs">{mention.newName}</code> for{" "}
								<code className="font-mono text-xs">{mention.name}</code>
							</li>
						))}
					</ul>
				</Section>
			)}
		</div>
	);
}

export interface ConductorImportDialogProps {
	onClose: () => void;
	/** Called by Done once the import has written everything. Without it, Done closes. */
	onImported?: () => void;
}

export function ConductorImportDialog({ onClose, onImported }: ConductorImportDialogProps) {
	const actions = useActions();
	const state = useConductorImport();
	const [importing, setImporting] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void actions.conductorImport.preview();
	}, [actions]);

	const close = () => {
		if (importing || state.phase === "importing") return;
		if (state.phase !== "imported") void actions.conductorImport.cancel();
		onClose();
	};

	const runImport = async () => {
		setImporting(true);
		await actions.conductorImport.run();
		setImporting(false);
	};

	const preview = state.phase === "planned" ? state.preview : null;
	const canImport = preview !== null && toImport(preview) > 0 && !importing;

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent
				title="Import from Conductor"
				description="Conductor's files are only read, so you can always go back to it. Nothing changes until you import."
				onConfirm={canImport ? () => void runImport() : undefined}
			>
				<div className="flex flex-col gap-4 overflow-y-auto">
					{state.phase === "planning" || state.phase === "idle" ? (
						<div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
							<Spinner label="Reading Conductor's data" size="sm" />
							Reading a copy of Conductor's data…
						</div>
					) : null}
					{state.phase === "importing" ? (
						<div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
							<Spinner label="Importing" size="sm" />
							Importing…
						</div>
					) : null}
					{state.phase === "failed" && state.error !== null ? (
						<Alert tone="destructive">
							<AlertDescription>{state.error.message}</AlertDescription>
						</Alert>
					) : null}
					{state.phase === "imported" && state.imported !== null ? (
						<>
							<p role="status" className="text-sm text-fg">
								Imported {count(state.imported.repos, "project")},{" "}
								{count(state.imported.workspaces, "workspace")} and{" "}
								{count(state.imported.chats, "chat")}
								{state.history === null || state.history.chats === 0
									? ""
									: `, with the history of ${count(state.history.chats, "chat")}`}
								. Chats continue from each agent's own transcript.
							</p>
							{state.history === null ? null : <HistoryResult history={state.history} />}
						</>
					) : null}
					{preview !== null ? (
						<>
							{toImport(preview) === 0 ? (
								<p role="status" className="text-sm text-fg">
									Nothing new to bring over. Everything that can come over is already here.
								</p>
							) : null}
							<PreviewDetails preview={preview} />
						</>
					) : null}
				</div>
				<DialogFooter>
					{state.phase === "imported" ? (
						<Button onClick={() => (onImported ?? onClose)()}>Done</Button>
					) : (
						<>
							<Button variant="secondary" disabled={importing} onClick={close}>
								Cancel
							</Button>
							{state.phase === "failed" ? (
								<Button onClick={() => void actions.conductorImport.preview()}>Try again</Button>
							) : (
								<Button loading={importing} disabled={!canImport} onClick={() => void runImport()}>
									Import
								</Button>
							)}
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The General page row: what the import does, and the button that opens the dry run. */
export function ConductorImportRow() {
	const state = useConductorImport();
	const [open, setOpen] = useState(false);
	const missing = state.found === null;
	return (
		<div className="flex items-center justify-between gap-8 border-t border-border py-5">
			<div className="flex min-w-0 flex-col">
				<p className="flex min-h-7 items-center text-sm font-medium text-fg">
					Import from Conductor
				</p>
				<p className="mt-0.5 text-sm text-fg-muted">
					{missing
						? "Conductor's data was not found on this Mac."
						: "Bring your projects, workspaces, chats and settings over. Conductor's files are only read."}
				</p>
			</div>
			<Button variant="outline" disabled={missing} onClick={() => setOpen(true)}>
				Review import
			</Button>
			{open ? <ConductorImportDialog onClose={() => setOpen(false)} /> : null}
		</div>
	);
}

/** The first-run button, shown only when Conductor's data is on this Mac. */
export function ConductorImportOffer({ onImported }: { onImported: () => void }) {
	const state = useConductorImport();
	const [open, setOpen] = useState(false);
	if (state.found === null || state.found === undefined) return null;
	return (
		<>
			<Button variant="outline" onClick={() => setOpen(true)}>
				Import from Conductor
			</Button>
			{open ? (
				<ConductorImportDialog onClose={() => setOpen(false)} onImported={onImported} />
			) : null}
		</>
	);
}
