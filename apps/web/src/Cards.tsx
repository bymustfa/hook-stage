import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { eventSummary, repeatCount, sortDeliveries, type Delivery, type Scenario, type VariantId } from "@hook-stage/scenario";

export function DeliveryCards(props: {
  scenario: Scenario;
  variantId: VariantId;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelay: (id: string, atMs: number) => void;
}) {
  const variant = props.scenario.variants.find((item) => item.id === props.variantId);
  const visual = sortDeliveries(variant?.deliveries ?? []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const seen = new Set<string>();
  const repeatIds = new Set<string>();
  for (const delivery of visual) {
    if (seen.has(delivery.eventKey)) repeatIds.add(delivery.id);
    seen.add(delivery.eventKey);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = visual.findIndex((delivery) => delivery.id === event.active.id);
    const to = visual.findIndex((delivery) => delivery.id === event.over?.id);
    if (from >= 0 && to >= 0) props.onReorder(from, to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visual.map((delivery) => delivery.id)} strategy={verticalListSortingStrategy}>
        <ol className="cards">
          {visual.map((delivery, index) => (
            <SortableCard
              key={delivery.id}
              delivery={delivery}
              index={index}
              total={visual.length}
              scenario={props.scenario}
              repeat={repeatIds.has(delivery.id)}
              shared={repeatCount(visual, delivery.eventKey) > 1}
              selected={delivery.id === props.selectedId}
              onSelect={() => props.onSelect(delivery.id)}
              onDuplicate={() => props.onDuplicate(delivery.id)}
              onRemove={() => props.onRemove(delivery.id)}
              onMove={(direction) => props.onMove(delivery.id, direction)}
              onDelay={(atMs) => props.onDelay(delivery.id, atMs)}
            />
          ))}
        </ol>
      </SortableContext>
      {visual.length === 0 ? (
          <div className="empty-copy">
            <p>This flow has no deliveries.</p>
            <p>Add one from the event library, or copy the normal flow into this tab.</p>
          </div>
        ) : null}
      <p className="hint">Tab to a grip, press Space, then use the arrow keys. Time slots stay in order; the event moves between them.</p>
    </DndContext>
  );
}

function SortableCard(props: {
  delivery: Delivery;
  index: number;
  total: number;
  scenario: Scenario;
  repeat: boolean;
  shared: boolean;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelay: (atMs: number) => void;
}) {
  const sortable = useSortable({ id: props.delivery.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const event = props.scenario.events.find((item) => item.key === props.delivery.eventKey);
  const summary = eventSummary(event?.body);
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={props.selected ? "card selected" : sortable.isDragging ? "card dragging" : "card"}
    >
      <div
        className="grip"
        aria-label={`Reorder ${props.delivery.eventKey}. Press space, then arrow keys.`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        ::
      </div>
      <button type="button" className="card-main" onClick={props.onSelect} aria-pressed={props.selected}>
        <span className="cue">{String(props.index + 1).padStart(2, "0")}</span>
        <span>
          <strong>{props.delivery.eventKey}</strong>
          {props.repeat ? <span className="badge">Repeat</span> : null}
          {props.shared && !props.repeat ? <span className="badge quiet">Shared event</span> : null}
          <small>
            {summary.type ?? "event"} · id {summary.id ?? "—"}
          </small>
        </span>
      </button>
      <label className="delay">
        Send at
        <input
          type="number"
          min={0}
          max={600000}
          step={50}
          value={props.delivery.atMs}
          aria-label={`Delay for ${props.delivery.eventKey} in milliseconds`}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 0 && value <= 600000) props.onDelay(value);
          }}
        />
        ms
      </label>
      <div className="card-ops">
        <button type="button" onClick={() => props.onMove(-1)} disabled={props.index === 0} aria-label="Move earlier">
          Up
        </button>
        <button type="button" onClick={() => props.onMove(1)} disabled={props.index === props.total - 1} aria-label="Move later">
          Down
        </button>
        <button type="button" onClick={props.onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="danger" onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}
