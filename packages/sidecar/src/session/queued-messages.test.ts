import { expect, test } from "bun:test";
import type { MessageId } from "@conducted/shared";
import { QueuedMessages } from "./queued-messages.ts";
import type { TurnRequest } from "./turn.ts";

const request = (id: string) => ({ messageId: id as MessageId }) as TurnRequest;

test("messages leave in the order they arrived", () => {
	const queue = new QueuedMessages();
	queue.enqueue(request("a"));
	queue.enqueue(request("b"));
	expect(queue.dequeue()?.messageId).toBe("a" as MessageId);
	expect(queue.dequeue()?.messageId).toBe("b" as MessageId);
	expect(queue.dequeue()).toBeUndefined();
});

test("clear returns the dropped ids", () => {
	const queue = new QueuedMessages();
	queue.enqueue(request("a"));
	queue.enqueue(request("b"));
	expect(queue.clear()).toEqual(["a", "b"] as MessageId[]);
	expect(queue.size).toBe(0);
});
