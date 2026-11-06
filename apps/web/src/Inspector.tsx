import { useState } from "react";
import type { Assertion, Scenario, VariantId } from "@hook-stage/scenario";

export function Inspector(props: {
  scenario: Scenario;
  variantId: VariantId;
  deliveryId: string | null;
  onChange: (scenario: Scenario) => void;
  onJsonError: (message: string | null) => void;
}) {
  const [tab, setTab] = useState<"event" | "checks">("event");
  const variant = props.scenario.variants.find((item) => item.id === props.variantId);
  const delivery = variant?.deliveries.find((item) => item.id === props.deliveryId) ?? null;
  const event = props.scenario.events.find((item) => item.key === delivery?.eventKey) ?? null;

  return (
    <aside className="inspector">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "event"} onClick={() => setTab("event")}>
          Event
        </button>
        <button type="button" role="tab" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>
          Verification
        </button>
      </div>
      {tab === "event" ? (
        <div className="inspector-body">
          {delivery && event ? (
            <>
              <p className="kicker">Delivery {delivery.id}</p>
              <label>
                Event
                <select
                  value={delivery.eventKey}
                  onChange={(input) =>
                    props.onChange(mapDelivery(props.scenario, props.variantId, delivery.id, { eventKey: input.target.value }))
                  }
                >
                  {props.scenario.events.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.key}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Duplicate keeps this payload and event id. A new event is a different operation.
                {props.scenario.variants.some((item) => item.deliveries.filter((row) => row.eventKey === event.key).length > 1)
                  ? " This payload is shared by every delivery of this event."
                  : ""}
              </p>
              <JsonEditor
                key={event.key}
                label="Event JSON"
                value={event.body}
                onValid={(body) => {
                  props.onJsonError(null);
                  props.onChange({
                    ...props.scenario,
                    events: props.scenario.events.map((item) => (item.key === event.key ? { ...item, body } : item)),
                  });
                }}
                onInvalid={(message) => props.onJsonError(message)}
              />
            </>
          ) : (
            <p className="empty-copy">Select a delivery card to edit its event.</p>
          )}
          <EventLibrary scenario={props.scenario} variantId={props.variantId} onChange={props.onChange} />
        </div>
      ) : (
        <VerificationEditor scenario={props.scenario} onChange={props.onChange} onJsonError={props.onJsonError} />
      )}
    </aside>
  );
}

function EventLibrary(props: { scenario: Scenario; variantId: VariantId; onChange: (scenario: Scenario) => void }) {
  return (
    <div className="library">
      <div className="row-title">
        <h3>Event library</h3>
        <button type="button" onClick={() => props.onChange(addEvent(props.scenario, props.variantId))}>
          New event
        </button>
      </div>
      <ul>
        {props.scenario.events.map((event) => (
          <li key={event.key}>
            <span>{event.key}</span>
            <button type="button" onClick={() => props.onChange(addDelivery(props.scenario, props.variantId, event.key))}>
              Add to flow
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerificationEditor(props: {
  scenario: Scenario;
  onChange: (scenario: Scenario) => void;
  onJsonError: (message: string | null) => void;
}) {
  const verification = props.scenario.verification;
  if (!verification) {
    return (
      <div className="inspector-body">
        <p className="unverified">UNVERIFIED</p>
        <p className="hint">Without a state endpoint and assertions, a run cannot be called a business success.</p>
        <button
          type="button"
          className="primary"
          onClick={() =>
            props.onChange({
              ...props.scenario,
              verification: {
                statePath: "/__test/orders/order_demo",
                readyWhen: { pointer: "/pendingJobs", equals: 0 },
                timeoutMs: 5000,
                pollIntervalMs: 200,
                assertions: [
                  { pointer: "/status", operator: "equals", expected: "refunded" },
                  { pointer: "/paymentApplications", operator: "equals", expected: 1 },
                ],
              },
            })
          }
        >
          Add verification
        </button>
      </div>
    );
  }

  return (
    <div className="inspector-body">
      <label>
        State path
        <input
          value={verification.statePath}
          onChange={(input) => patchVerification(props, { statePath: input.target.value })}
        />
      </label>
      <label>
        Ready when
        <input
          value={verification.readyWhen.pointer}
          onChange={(input) =>
            patchVerification(props, { readyWhen: { ...verification.readyWhen, pointer: input.target.value } })
          }
        />
      </label>
      <JsonEditor
        label="Ready equals (JSON)"
        value={verification.readyWhen.equals}
        onValid={(equals) => {
          props.onJsonError(null);
          patchVerification(props, { readyWhen: { ...verification.readyWhen, equals } });
        }}
        onInvalid={props.onJsonError}
      />
      <div className="split">
        <label>
          Timeout ms
          <input
            type="number"
            min={200}
            max={30000}
            value={verification.timeoutMs}
            onChange={(input) => patchVerification(props, { timeoutMs: Number(input.target.value) })}
          />
        </label>
        <label>
          Poll ms
          <input
            type="number"
            min={50}
            max={5000}
            value={verification.pollIntervalMs}
            onChange={(input) => patchVerification(props, { pollIntervalMs: Number(input.target.value) })}
          />
        </label>
      </div>
      <div className="row-title">
        <h3>Assertions</h3>
        <button
          type="button"
          onClick={() =>
            patchVerification(props, {
              assertions: [...verification.assertions, { pointer: "/status", operator: "equals", expected: "refunded" }],
            })
          }
        >
          Add
        </button>
      </div>
      {verification.assertions.map((assertion, index) => (
        <AssertionEditor
          key={`${assertion.pointer}-${index}`}
          assertion={assertion}
          onChange={(next) => {
            const assertions = verification.assertions.map((item, itemIndex) => (itemIndex === index ? next : item));
            patchVerification(props, { assertions });
          }}
          onRemove={() =>
            patchVerification(props, {
              assertions: verification.assertions.filter((_, itemIndex) => itemIndex !== index),
            })
          }
          onJsonError={props.onJsonError}
        />
      ))}
      <button type="button" className="danger" onClick={() => props.onChange({ ...props.scenario, verification: undefined })}>
        Remove verification
      </button>
      <label>
        Fixture reset path
        <input
          value={props.scenario.reset?.path ?? ""}
          placeholder="/__test/reset"
          onChange={(input) => {
            const path = input.target.value.trim();
            props.onChange({
              ...props.scenario,
              reset: path ? { method: "POST", path } : undefined,
            });
          }}
        />
      </label>
      <p className="hint">
        {props.scenario.reset
          ? "This POST runs only after you confirm it in the run preview. hook-stage never wipes application data on its own."
          : "No fixture reset hook. Runs without one are not treated as a clean comparison."}
      </p>
    </div>
  );
}

function AssertionEditor(props: {
  assertion: Assertion;
  onChange: (assertion: Assertion) => void;
  onRemove: () => void;
  onJsonError: (message: string | null) => void;
}) {
  return (
    <fieldset className="assertion">
      <label>
        Pointer
        <input value={props.assertion.pointer} onChange={(input) => props.onChange({ ...props.assertion, pointer: input.target.value })} />
      </label>
      <label>
        Operator
        <select
          value={props.assertion.operator}
          onChange={(input) => {
            const operator = input.target.value === "exists" ? "exists" : "equals";
            props.onChange(
              operator === "exists"
                ? { pointer: props.assertion.pointer, operator }
                : { pointer: props.assertion.pointer, operator, expected: props.assertion.expected ?? "" },
            );
          }}
        >
          <option value="equals">equals</option>
          <option value="exists">exists</option>
        </select>
      </label>
      {props.assertion.operator === "equals" ? (
        <JsonEditor
          label="Expected JSON"
          value={props.assertion.expected ?? null}
          onValid={(expected) => {
            props.onJsonError(null);
            props.onChange({ ...props.assertion, operator: "equals", expected });
          }}
          onInvalid={props.onJsonError}
        />
      ) : null}
      <button type="button" onClick={props.onRemove}>
        Remove check
      </button>
    </fieldset>
  );
}

function JsonEditor(props: {
  label: string;
  value: unknown;
  onValid: (value: unknown) => void;
  onInvalid: (message: string) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(props.value, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="json-field">
      {props.label}
      <textarea
        spellCheck={false}
        value={text}
        aria-invalid={Boolean(error)}
        onChange={(input) => {
          const next = input.target.value;
          setText(next);
          try {
            const parsed = JSON.parse(next) as unknown;
            setError(null);
            props.onValid(parsed);
          } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : "Invalid JSON";
            setError(message);
            props.onInvalid(message);
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

function patchVerification(
  props: { scenario: Scenario; onChange: (scenario: Scenario) => void },
  patch: Partial<NonNullable<Scenario["verification"]>>,
) {
  if (!props.scenario.verification) return;
  props.onChange({ ...props.scenario, verification: { ...props.scenario.verification, ...patch } });
}

function mapDelivery(scenario: Scenario, variantId: VariantId, deliveryId: string, patch: { eventKey?: string }): Scenario {
  return {
    ...scenario,
    variants: scenario.variants.map((variant) =>
      variant.id === variantId
        ? {
            ...variant,
            deliveries: variant.deliveries.map((delivery) => (delivery.id === deliveryId ? { ...delivery, ...patch } : delivery)),
          }
        : variant,
    ),
  };
}

function addEvent(scenario: Scenario, variantId: VariantId): Scenario {
  let number = scenario.events.length + 1;
  let key = `event_${number}`;
  while (scenario.events.some((event) => event.key === key)) {
    number += 1;
    key = `event_${number}`;
  }
  const next: Scenario = {
    ...scenario,
    events: [
      ...scenario.events,
      { key, body: { id: `evt_${key}`, type: "order.paid", orderId: "order_demo", version: number } },
    ],
  };
  return addDelivery(next, variantId, key);
}

function addDelivery(scenario: Scenario, variantId: VariantId, eventKey: string): Scenario {
  const variant = scenario.variants.find((item) => item.id === variantId);
  const last = [...(variant?.deliveries ?? [])].sort((left, right) => left.atMs - right.atMs).at(-1);
  const id = uniqueId(scenario);
  return {
    ...scenario,
    variants: scenario.variants.map((item) =>
      item.id === variantId
        ? {
            ...item,
            deliveries: [...item.deliveries, { id, eventKey, atMs: Math.min(600000, (last?.atMs ?? 0) + 300) }],
          }
        : item,
    ),
  };
}

function uniqueId(scenario: Scenario): string {
  const used = new Set(scenario.variants.flatMap((variant) => variant.deliveries.map((delivery) => delivery.id)));
  let id = `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  while (used.has(id)) id = `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  return id;
}
