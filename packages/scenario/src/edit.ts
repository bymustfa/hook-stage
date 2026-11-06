import { LIMITS } from "./limits.js";
import type { Delivery, Scenario, VariantId } from "./types.js";
import { variantById } from "./validate.js";

export function eventSummary(body: unknown): { id: string | null; type: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { id: null, type: null };
  const record = body as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : null,
    type: typeof record.type === "string" ? record.type : null,
  };
}

export function sortDeliveries(deliveries: Delivery[]): Delivery[] {
  return deliveries
    .map((delivery, index) => ({ delivery, index }))
    .sort((left, right) => left.delivery.atMs - right.delivery.atMs || left.index - right.index)
    .map((item) => item.delivery);
}

export function blankScenario(name = "New scenario"): Scenario {
  return {
    formatVersion: 1,
    name,
    description: "Describe the delivery mistake you want to reproduce.",
    targetProfile: "local-demo",
    events: [
      {
        key: "paid",
        body: { id: "evt_paid", type: "order.paid", orderId: "order_demo", version: 1 },
      },
    ],
    variants: [
      { id: "normal", deliveries: [{ id: "d_normal", eventKey: "paid", atMs: 0 }] },
      { id: "modified", deliveries: [{ id: "d_modified", eventKey: "paid", atMs: 0 }] },
    ],
  };
}

function uniqueDeliveryId(scenario: Scenario): string {
  const used = new Set(scenario.variants.flatMap((variant) => variant.deliveries.map((delivery) => delivery.id)));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    if (!used.has(id)) return id;
  }
  return `d_${Date.now().toString(36)}`;
}

function mapVariant(scenario: Scenario, variantId: VariantId, deliveries: Delivery[]): Scenario {
  return {
    ...scenario,
    variants: scenario.variants.map((variant) => (variant.id === variantId ? { ...variant, deliveries } : variant)),
  };
}

/** A repeat keeps the event key, body, and event id. Only the delivery id is new. */
export function duplicateDelivery(scenario: Scenario, variantId: VariantId, deliveryId: string): Scenario {
  const variant = variantById(scenario, variantId);
  const visual = sortDeliveries(variant.deliveries);
  const index = visual.findIndex((delivery) => delivery.id === deliveryId);
  const source = visual[index];
  if (!source) throw new Error(`Unknown delivery "${deliveryId}"`);
  const copy: Delivery = {
    id: uniqueDeliveryId(scenario),
    eventKey: source.eventKey,
    atMs: Math.min(LIMITS.atMsMax, source.atMs + 500),
  };
  const next = [...visual.slice(0, index + 1), copy, ...visual.slice(index + 1)];
  return mapVariant(scenario, variantId, next);
}

/**
 * Move a card in the visible order. Time slots stay put; the events change slots.
 * List order remains the tie-break when two deliveries share atMs.
 */
export function moveDelivery(scenario: Scenario, variantId: VariantId, fromIndex: number, toIndex: number): Scenario {
  const variant = variantById(scenario, variantId);
  const visual = sortDeliveries(variant.deliveries);
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= visual.length || toIndex >= visual.length || fromIndex === toIndex) {
    return scenario;
  }
  const times = visual.map((delivery) => delivery.atMs);
  const [moved] = visual.splice(fromIndex, 1);
  if (!moved) return scenario;
  visual.splice(toIndex, 0, moved);
  const next = visual.map((delivery, index) => ({ ...delivery, atMs: times[index] ?? delivery.atMs }));
  return mapVariant(scenario, variantId, next);
}

export function removeDelivery(scenario: Scenario, variantId: VariantId, deliveryId: string): Scenario {
  const variant = variantById(scenario, variantId);
  return mapVariant(
    scenario,
    variantId,
    variant.deliveries.filter((delivery) => delivery.id !== deliveryId),
  );
}

export function setDeliveryTime(scenario: Scenario, variantId: VariantId, deliveryId: string, atMs: number): Scenario {
  const variant = variantById(scenario, variantId);
  return mapVariant(
    scenario,
    variantId,
    variant.deliveries.map((delivery) => (delivery.id === deliveryId ? { ...delivery, atMs } : delivery)),
  );
}

export function copyNormalIntoModified(scenario: Scenario): Scenario {
  const normal = variantById(scenario, "normal");
  const used = new Set(normal.deliveries.map((delivery) => delivery.id));
  const deliveries = normal.deliveries.map((delivery) => {
    let id = `m_${delivery.id}`.slice(0, 40);
    while (used.has(id)) id = `m_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    used.add(id);
    return { id, eventKey: delivery.eventKey, atMs: delivery.atMs };
  });
  return mapVariant(scenario, "modified", deliveries);
}

export function repeatCount(deliveries: Delivery[], eventKey: string): number {
  return deliveries.filter((delivery) => delivery.eventKey === eventKey).length;
}
