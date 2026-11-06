/**
 * @feature APP-09 Send feedback
 * Owns: the Feedback dialog: a message, an optional email, images, "Include recent app logs" with
 * a View link, and Send feedback, which opens the project's new-issue page through
 * `Actions.app.sendFeedback`.
 * Behaviour: ui-map.md 5.2 (Feedback: Message, Your email, drop images, "Include recent app logs"),
 * 5.4 (Cmd+Alt+F, fixed); native-and-sidecar-map.md A5 (Help > Send Feedback); Conductor's dialog
 * (renderApp `Oel`) for the wording: the message placeholder, "your.email@example.com",
 * "Attach images", "Include recent app logs (may include personal data)",
 * "View", "Send feedback" and "Sending...", and the errors "Please enter your feedback message.",
 * "Please select image files only.", "Please drop image files only.", "Maximum 5 images
 * allowed." and "Failed to open app logs.".
 * Must handle: an empty message (Send stays disabled, and Cmd+Enter says to write one); a sixth
 * image (refused); a file that is not a png, jpg, jpeg, gif or webp (refused); a file dropped on
 * the window while the dialog is open (added as an image, and not to the open chat's draft); a
 * second Cmd+Enter or click while a send runs (ignored, so one issue page opens); a log export,
 * a message too long for the link or an issue page that fails (the error is shown and the dialog
 * stays open with the text kept).
 * Our design choice: Conductor sends the form to its own service; ours opens the project's
 * GitHub issue page (APP-09's row), so the email is optional and goes into the issue only if the
 * user types it, and images are listed by path because a link cannot upload them. Conductor's
 * "You can also reach us at support@conductor.build" line is left out: we have no support
 * address. Conductor's toast, "Thank you for your feedback!", says the feedback arrived; nothing
 * has arrived when our page opens, so ours says "Opened the feedback page" and asks the user to
 * submit the issue there.
 * Test first: Cmd+Alt+F opens the dialog; sending a message opens the issue page and says so.
 */
import { messageOf } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { isImagePath } from "../../core/media-files.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Input, Label, Textarea } from "../../ui/Input.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { toast } from "../../ui/Toast.tsx";

/** At most this many images, as Conductor allows. */
const MAX_IMAGES = 5;
/** The image kinds Conductor's dialog takes, fewer than the chat shows. */
const FEEDBACK_IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "webp"];

const fileName = (path: string): string => path.split("/").pop() ?? path;

export function FeedbackDialog({ open, onOpenChange }: OverlayProps) {
	const { platform, services } = useServices();
	const actions = useActions();
	const [message, setMessage] = useState("");
	const [email, setEmail] = useState("");
	const [images, setImages] = useState<string[]>([]);
	const [includeLogs, setIncludeLogs] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	// Cmd+Enter and the button both send; a second press while the first runs opens no second page.
	const flight = useRef(createSingleFlight()).current;

	const addImages = (paths: readonly string[], refusal: string) => {
		const accepted = paths.filter((path) => isImagePath(path, FEEDBACK_IMAGE_EXTENSIONS));
		const next = [...images];
		let full = false;
		for (const path of accepted) {
			if (next.includes(path)) continue;
			if (next.length >= MAX_IMAGES) {
				full = true;
				break;
			}
			next.push(path);
		}
		setImages(next);
		if (full) setError("Maximum 5 images allowed.");
		else if (accepted.length < paths.length) setError(refusal);
		else setError(null);
	};

	// A file dragged onto the window while the dialog is open is offered to it. The ref keeps the
	// listener on the newest image list without subscribing again on every change.
	const addImagesRef = useRef(addImages);
	addImagesRef.current = addImages;
	useEffect(
		() =>
			platform.window.onFileDrop((event) => {
				if (event.kind === "drop")
					addImagesRef.current(event.paths, "Please drop image files only.");
			}),
		[platform],
	);

	const pickImages = async () => {
		let picked: string[];
		try {
			picked = await platform.dialogs.pickFiles({ title: "Attach images", multiple: true });
		} catch (cause) {
			setError(messageOf(cause));
			return;
		}
		addImages(picked, "Please select image files only.");
	};

	const viewLogs = async () => {
		const opened = await services.commands.run("app.openLogViewer");
		if (!opened.ok) setError("Failed to open app logs.");
	};

	const send = () =>
		flight.run("send", async () => {
			setError(null);
			if (message.trim() === "") {
				setError("Please enter your feedback message.");
				return;
			}
			setSending(true);
			const sent = await actions.app.sendFeedback({
				message,
				email: email.trim() === "" ? null : email.trim(),
				imagePaths: images,
				includeLogs,
			});
			setSending(false);
			if (!sent.ok) {
				setError(sent.error.message);
				return;
			}
			toast.success("Opened the feedback page", {
				description: "Submit the issue there to send your feedback.",
			});
			onOpenChange(false);
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Feedback" onConfirm={() => void send()}>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="feedback-message">Message</Label>
						<Textarea
							id="feedback-message"
							rows={5}
							autoFocus
							disabled={sending}
							placeholder="Tell us about your experience, bugs you've found, or features you'd like to see..."
							value={message}
							onChange={(event) => setMessage(event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="feedback-email">Your email</Label>
						<Input
							id="feedback-email"
							type="email"
							disabled={sending}
							placeholder="your.email@example.com"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</div>
					{images.length === 0 ? null : (
						<ul aria-label="Images" className="flex flex-wrap gap-2">
							{images.map((path) => (
								<li key={path} className="relative">
									<img
										src={platform.fs.assetUrl(path)}
										alt={fileName(path)}
										title={fileName(path)}
										className="size-20 rounded-md border border-border bg-muted object-cover"
									/>
									<span className="absolute -top-2 -right-2 rounded-full bg-raised">
										<IconButton
											size="xs"
											label={`Remove ${fileName(path)}`}
											icon={<CloseIcon width={12} height={12} />}
											onClick={() =>
												setImages((current) => current.filter((entry) => entry !== path))
											}
										/>
									</span>
								</li>
							))}
						</ul>
					)}
					<div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
						<label htmlFor="feedback-logs" className="flex min-w-0 items-center gap-2">
							<Checkbox
								id="feedback-logs"
								checked={includeLogs}
								disabled={sending}
								onCheckedChange={setIncludeLogs}
							/>
							<span className="min-w-0">Include recent app logs (may include personal data)</span>
						</label>
						<Button variant="link" size="xs" disabled={sending} onClick={() => void viewLogs()}>
							View
						</Button>
					</div>
					{error === null ? null : (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}
					<div className="flex items-center justify-between gap-2">
						<Button variant="ghost" size="sm" disabled={sending} onClick={() => void pickImages()}>
							Attach images
						</Button>
						<Button type="submit" disabled={sending || message.trim() === ""}>
							{sending ? (
								"Sending..."
							) : (
								<>
									Send feedback <Kbd>⌘↵</Kbd>
								</>
							)}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
