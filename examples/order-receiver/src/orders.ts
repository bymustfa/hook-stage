/**
 * Synthetic order book for the payment/refund demo. No money moves.
 *
 * buggy: every delivery is applied. A duplicate event id counts again, and a
 * late order.paid overwrites a newer refund.
 *
 * fixed: the apply step records the event id in the same synchronous section
 * that mutates the order. A promise queue keeps those sections from
 * interleaving. A domain version that is not newer than the order is ignored.
 * This is not an exactly-once or ordering guarantee for real providers.
 */

export type ReceiverMode = "buggy" | "fixed";

export interface OrderEvent {
  id: string;
  type: string;
  orderId: string;
  version: number;
}

export interface OrderState {
  id: string;
  status: "none" | "paid" | "refunded";
  version: number;
  paymentApplications: number;
  pendingJobs: number;
  appliedEventIds: string[];
  ignoredEventIds: string[];
}

export function createOrderBook(mode: ReceiverMode, applyDelayMs = 30) {
  const orders = new Map<string, OrderState>();
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  function blank(id: string): OrderState {
    return {
      id,
      status: "none",
      version: 0,
      paymentApplications: 0,
      pendingJobs: 0,
      appliedEventIds: [],
      ignoredEventIds: [],
    };
  }

  function ensure(id: string): OrderState {
    const existing = orders.get(id);
    if (existing) return existing;
    const created = blank(id);
    orders.set(id, created);
    return created;
  }

  function snapshot(orderId: string): OrderState {
    const order = ensure(orderId);
    return {
      ...order,
      appliedEventIds: [...order.appliedEventIds],
      ignoredEventIds: [...order.ignoredEventIds],
    };
  }

  function reset(): void {
    generation += 1;
    orders.clear();
    queue = Promise.resolve();
  }

  function apply(order: OrderState, event: OrderEvent): void {
    if (mode === "fixed") {
      if (order.appliedEventIds.includes(event.id) || order.ignoredEventIds.includes(event.id)) {
        order.ignoredEventIds.push(event.id);
        return;
      }
      if (event.version <= order.version) {
        order.ignoredEventIds.push(event.id);
        return;
      }
    }

    if (event.type === "order.paid") {
      order.paymentApplications += 1;
      order.status = "paid";
      order.version = event.version;
      order.appliedEventIds.push(event.id);
      return;
    }

    if (event.type === "order.refunded") {
      order.status = "refunded";
      order.version = event.version;
      order.appliedEventIds.push(event.id);
    }
  }

  function accept(event: OrderEvent): { received: true } {
    const seenAt = generation;
    const order = ensure(event.orderId);
    order.pendingJobs += 1;
    queue = queue
      .then(async () => {
        if (applyDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, applyDelayMs));
        if (seenAt !== generation) return;
        apply(ensure(event.orderId), event);
      })
      .finally(() => {
        if (seenAt !== generation) return;
        const current = orders.get(event.orderId);
        if (current) current.pendingJobs = Math.max(0, current.pendingJobs - 1);
      });
    return { received: true };
  }

  function idle(): Promise<void> {
    return queue;
  }

  return { mode, snapshot, reset, accept, idle };
}

export function parseOrderEvent(value: unknown): OrderEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 80) return null;
  if (typeof record.type !== "string" || record.type.length === 0 || record.type.length > 80) return null;
  if (typeof record.orderId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(record.orderId)) return null;
  if (typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 0 || record.version > 1_000_000) {
    return null;
  }
  return { id: record.id, type: record.type, orderId: record.orderId, version: record.version };
}
