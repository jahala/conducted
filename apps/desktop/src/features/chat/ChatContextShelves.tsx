/**
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the shelves an empty chat shows above its starters: "New chat in /<directory>.", the
 * workspace's earlier chats under "Add chat transcripts:" and the plans its agents proposed under
 * "Add plans:". Picking one attaches it to this chat's draft; picking it again takes it off.
 * Behaviour: inventory label #340-341 and inventory:toast rows 756 to 758; Conductor's empty chat
 * (renderApp `_1a`, `vsi`, `f1a`, `h1a`): only chats with a user message are listed, newest
 * first; at most five items per shelf, else four and a "+N more" popover with the rest; nothing at
 * all when both shelves are empty; an item being attached shows a spinner and cannot be picked.
 * Must handle: a chat with no messages left ("No messages in this chat"); a transcript or plan
 * that cannot be saved ("Failed to attach chat transcript", "Failed to attach plan"); the plans
 * list failing to load (the shelf is left out, the chats still show).
 * Our design choice: an item counts as attached when the draft holds a file of its name. The
 * plan's hover preview that Conductor shows is not built.
 * Test first: an empty chat lists "Add chat transcripts:" and "Add plans:" and attaching a chat
 * puts its transcript file in the draft.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type ReactNode, useMemo, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useDraft, usePlans, useSessions } from "../../core/hooks.ts";
import type { PlanEntry, Session } from "../../core/model.ts";
import { chatTranscriptFileName, planFileName } from "../../core/services/composer.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { ChatIcon, FileTextIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

/** Items a shelf shows before the rest go behind "+N more" (Conductor's `u1a` and `d1a`). */
const MAX_VISIBLE = 5;

export interface ChatContextShelvesProps {
	sessionId: SessionId;
	workspaceId: WorkspaceId;
	/** The workspace's folder name, shown as "/<name>". */
	directory: string;
}

function baseName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

function planKey(plan: PlanEntry): string {
	return `${plan.sessionId}:${plan.turnId}:${plan.title}`;
}

interface ShelfProps<T> {
	label: string;
	items: readonly T[];
	keyOf: (item: T) => string;
	render: (item: T) => ReactNode;
}

function Shelf<T>({ label, items, keyOf, render }: ShelfProps<T>) {
	const visible = items.length <= MAX_VISIBLE ? items : items.slice(0, MAX_VISIBLE - 1);
	const rest = items.length <= MAX_VISIBLE ? [] : items.slice(MAX_VISIBLE - 1);
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs text-fg-muted">{label}</p>
			<div className="flex flex-wrap items-center gap-1.5">
				{visible.map((item) => (
					<span key={keyOf(item)} className="contents">
						{render(item)}
					</span>
				))}
				{rest.length === 0 ? null : (
					<Popover
						side="bottom"
						align="start"
						trigger={
							<Button variant="ghost" size="xs">
								+{rest.length} more
							</Button>
						}
					>
						<div className="flex max-h-72 w-64 flex-col gap-1.5 overflow-y-auto">
							{rest.map((item) => (
								<span key={keyOf(item)} className="contents">
									{render(item)}
								</span>
							))}
						</div>
					</Popover>
				)}
			</div>
		</div>
	);
}

interface ShelfItemProps {
	label: string;
	icon: ReactNode;
	selected: boolean;
	importing: boolean;
	onPick: () => void;
	className?: string;
}

function ShelfItem({ label, icon, selected, importing, onPick, className }: ShelfItemProps) {
	return (
		<Button
			variant="outline"
			size="xs"
			title={label}
			aria-label={label}
			aria-pressed={selected}
			disabled={importing}
			onClick={onPick}
			className={cn(
				selected && "border-primary-fill bg-primary-fill text-canvas hover:opacity-90",
				importing && "opacity-50",
				className,
			)}
		>
			{importing ? <Spinner size="sm" label="Attaching" /> : icon}
			<span className="truncate">{label}</span>
		</Button>
	);
}

/** Reads what the shelves list; draws them only when there is something to add. */
export function ChatContextShelves({ sessionId, workspaceId, directory }: ChatContextShelvesProps) {
	const sessions = useSessions(workspaceId);
	const plans = usePlans(workspaceId);
	const chats = useMemo(() => {
		if (sessions.state !== "ready") return [];
		return sessions.data
			.filter((session) => session.id !== sessionId && session.lastUserMessageAt !== null)
			.sort((a, b) => (b.lastUserMessageAt ?? 0) - (a.lastUserMessageAt ?? 0));
	}, [sessions, sessionId]);
	const planList = plans.state === "ready" ? plans.data : [];
	if (chats.length === 0 && planList.length === 0) return null;
	return <Shelves sessionId={sessionId} directory={directory} chats={chats} plans={planList} />;
}

interface ShelvesProps {
	sessionId: SessionId;
	directory: string;
	chats: readonly Session[];
	plans: readonly PlanEntry[];
}

function Shelves({ sessionId, directory, chats, plans: planList }: ShelvesProps) {
	const { services } = useServices();
	const actions = useActions();
	const attached = useDraft(sessionId).attachmentPaths;
	const [importingChats, setImportingChats] = useState<readonly SessionId[]>([]);
	const [importingPlans, setImportingPlans] = useState<readonly string[]>([]);
	const attachedByName = new Map(attached.map((path) => [baseName(path), path]));

	const detach = async (path: string) => {
		const removed = await services.composer.removeAttachment(sessionId, path);
		if (!removed.ok) toastError("Couldn't remove the attachment", removed.error);
	};

	const pickChat = async (chat: Session) => {
		const existing = attachedByName.get(chatTranscriptFileName(chat.title));
		if (existing !== undefined) return detach(existing);
		setImportingChats((current) => [...current, chat.id]);
		const added = await actions.attachments.addChatTranscript(sessionId, chat.id);
		setImportingChats((current) => current.filter((id) => id !== chat.id));
		if (!added.ok) toast.error(added.error.message);
	};

	const pickPlan = async (plan: PlanEntry) => {
		const existing = attachedByName.get(planFileName(plan.title));
		if (existing !== undefined) return detach(existing);
		const key = planKey(plan);
		setImportingPlans((current) => [...current, key]);
		const added = await actions.attachments.addPlan(sessionId, plan);
		setImportingPlans((current) => current.filter((entry) => entry !== key));
		if (!added.ok) toast.error(added.error.message);
	};

	return (
		<div className="mb-2 flex w-full flex-col gap-3 text-left">
			<p className="text-xs text-fg-muted">
				New chat in <span className="font-mono">/{directory}</span>.
			</p>
			{chats.length === 0 ? null : (
				<Shelf
					label="Add chat transcripts:"
					items={chats}
					keyOf={(chat) => chat.id}
					render={(chat) => (
						<ShelfItem
							label={chat.title ?? "chat"}
							icon={<ChatIcon className="size-3 shrink-0" />}
							selected={attachedByName.has(chatTranscriptFileName(chat.title))}
							importing={importingChats.includes(chat.id)}
							onPick={() => void pickChat(chat)}
							className="max-w-[150px]"
						/>
					)}
				/>
			)}
			{planList.length === 0 ? null : (
				<Shelf
					label="Add plans:"
					items={planList}
					keyOf={planKey}
					render={(plan) => (
						<ShelfItem
							label={plan.title}
							icon={<FileTextIcon className="size-3 shrink-0" />}
							selected={attachedByName.has(planFileName(plan.title))}
							importing={importingPlans.includes(planKey(plan))}
							onPick={() => void pickPlan(plan)}
							className="max-w-[220px]"
						/>
					)}
				/>
			)}
		</div>
	);
}
