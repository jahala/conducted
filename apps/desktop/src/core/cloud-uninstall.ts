/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the sentence the Cloud page shows after Remove deployment, built from what the shell said
 * it removed.
 * Behaviour: D109 and issue #635: the uninstall deletes the Worker, the container application and
 * images, then empties the bucket of the cloud settings and backups and deletes it. The page says
 * what went, so a user knows their saved files went with it.
 * Must handle: only what the shell counted is named; a second uninstall that found nothing says
 * so; one image or one file reads in the singular.
 * Test first: names the bucket's files with their count.
 */
import type { CloudUninstallResult } from "../platform/platform.ts";

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What the Cloud page says once an uninstall finished. */
export function uninstallSummary(removed: CloudUninstallResult): string {
	const parts: string[] = [];
	if (removed.worker) parts.push("the Worker");
	if (removed.container) parts.push("the container application");
	if (removed.images > 0) parts.push(removed.images === 1 ? "1 image" : `${removed.images} images`);
	if (removed.bucket) {
		parts.push(
			removed.objects === 0
				? "the empty bucket"
				: removed.objects === 1
					? "the bucket with the 1 file it held"
					: `the bucket with the ${removed.objects} files it held`,
		);
	}
	if (parts.length === 0) return "Nothing was left on your Cloudflare account to remove";
	return `Removed ${listed(parts)} from your Cloudflare account`;
}
