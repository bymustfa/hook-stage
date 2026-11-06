import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  blankScenario,
  copyNormalIntoModified,
  duplicateDelivery,
  moveDelivery,
  removeDelivery,
  setDeliveryTime,
  sortDeliveries,
  validateScenario,
  ScenarioValidationError,
  type Comparison,
  type RunView,
  type Scenario,
  type VariantId,
} from "@hook-stage/scenario";
import { createClient, type Client, type Profile, type ScenarioDetail, type ScenarioListItem } from "./api";
import { DeliveryCards } from "./Cards";
import { Inspector } from "./Inspector";
import { Results } from "./Results";

export function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Scenario | null>(null);
  const [draft, setDraft] = useState<Scenario | null>(null);
  const [variant, setVariant] = useState<VariantId>("normal");
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ normal: RunView | null; modified: RunView | null }>({ normal: null, modified: null });
  const [comparison, setComparison] = useState<Comparison>({
    comparable: false,
    reason: "Run both flows from a confirmed fixture reset to compare them.",
  });
  const [history, setHistory] = useState<ScenarioDetail["history"]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const watchRef = useRef<AbortController | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const validation = useMemo(() => {
    if (!draft) return "Loading…";
    try {
      validateScenario(draft);
      return null;
    } catch (error) {
      return error instanceof ScenarioValidationError ? error.errors.join(" ") : error instanceof Error ? error.message : "Invalid scenario";
    }
  }, [draft]);

  useEffect(() => {
    if (!preview && !discardTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreview(false);
      setDiscardTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, discardTarget]);

  useEffect(() => {
    let cancel = false;
    createClient()
      .then(async (next) => {
        if (cancel) return;
        setClient(next);
        const [list, nextProfiles] = await Promise.all([next.listScenarios(), next.listProfiles()]);
        if (cancel) return;
        setScenarios(list);
        setProfiles(nextProfiles);
        const first = list[0];
        if (first) await openScenario(next, first.id, false);
      })
      .catch((error: unknown) => setBanner(error instanceof Error ? error.message : "Could not reach hook-stage"));
    return () => {
      cancel = true;
      watchRef.current?.abort();
    };
    // The initial load is the only time this effect should run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openScenario(active: Client, id: string, guard: boolean) {
    if (guard && dirty) {
      setDiscardTarget(id);
      return;
    }
    const detail = await active.getScenario(id);
    setSelectedId(detail.id);
    setSaved(detail.document);
    setDraft(detail.document);
    setRuns(detail.latestRuns);
    setComparison(detail.comparison);
    setHistory(detail.history);
    setVariant("normal");
    setJsonError(null);
    const first = sortDeliveries(detail.document.variants.find((item) => item.id === "normal")?.deliveries ?? [])[0];
    setSelectedDeliveryId(first?.id ?? null);
  }

  async function refreshList(active: Client) {
    setScenarios(await active.listScenarios());
  }

  function applyDetail(detail: ScenarioDetail, replaceDraft: boolean) {
    setSaved(detail.document);
    if (replaceDraft) setDraft(detail.document);
    setComparison(detail.comparison);
    setHistory(detail.history);
    setRuns(detail.latestRuns);
  }

  async function save(active: Client, id: string, document: Scenario) {
    const detail = await active.saveScenario(id, document);
    applyDetail(detail, true);
    await refreshList(active);
    return detail;
  }

  function follow(active: Client, run: RunView) {
    watchRef.current?.abort();
    const controller = new AbortController();
    watchRef.current = controller;
    setRuns((current) => ({ ...current, [run.variantId]: run }));
    void active
      .watchRun(
        run.id,
        (next) => setRuns((current) => ({ ...current, [next.variantId]: next })),
        controller.signal,
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
      })
      .finally(async () => {
        if (controller.signal.aborted) return;
        try {
          const finalRun = await active.getRun(run.id);
          setRuns((current) => ({ ...current, [finalRun.variantId]: finalRun }));
          if (selectedId) {
            const detail = await active.getScenario(selectedId);
            setComparison(detail.comparison);
            setHistory(detail.history);
            setSaved(detail.document);
          }
          await refreshList(active);
        } catch (error) {
          if (!controller.signal.aborted) setBanner(error instanceof Error ? error.message : "Could not refresh the run");
        }
      });
  }

  const profile = profiles.find((item) => item.id === draft?.targetProfile) ?? null;
  const running = runs.normal?.status === "running" || runs.modified?.status === "running";

  return (
    <div className="app">
      <a className="skip" href="#studio">
        Skip to scenario
      </a>
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="wordmark">hook-stage</p>
            <p className="tag">Delivered is not the same as done.</p>
          </div>
        </div>
        {draft ? (
          <div className="target">
            <label>
              Target profile
              <select
                value={draft.targetProfile}
                onChange={(event) => setDraft({ ...draft, targetProfile: event.target.value })}
              >
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
                {profile ? null : <option value={draft.targetProfile}>{draft.targetProfile}</option>}
              </select>
            </label>
            <code>{profile ? `${profile.baseUrl}${profile.webhookPath}` : "Profile is not configured on this machine"}</code>
          </div>
        ) : null}
        <div className="top-actions">
          <button type="button" aria-pressed={railOpen} onClick={() => setRailOpen((open) => !open)}>
            {railOpen ? "Hide scenarios" : "Show scenarios"}
          </button>
          <button type="button" disabled={!dirty || !draft || Boolean(validation) || Boolean(jsonError) || busy} onClick={() => void onSave()}>
            Save
          </button>
          <button type="button" disabled={!draft || Boolean(validation) || Boolean(jsonError)} onClick={onExport}>
            Export JSON
          </button>
          <button type="button" className="primary" disabled={!draft || Boolean(validation) || Boolean(jsonError) || running || busy} onClick={() => setPreview(true)}>
            Run {variant}
          </button>
          {running ? (
            <button type="button" onClick={() => void onCancel()}>
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      {banner ? (
        <div className="banner" role="alert">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {validation && draft ? <p className="banner warn">{validation}</p> : null}

      <main id="studio" className={railOpen ? "workspace" : "workspace rail-closed"}>
        {railOpen ? (
        <nav className="rail" aria-label="Scenarios">
          <div className="rail-actions">
            <button type="button" onClick={() => void onCreate()}>
              New
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void onImport(event)}
            />
          </div>
          <ul>
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                <button
                  type="button"
                  className={scenario.id === selectedId ? "scenario active" : "scenario"}
                  onClick={() => client && void openScenario(client, scenario.id, true).catch((error: unknown) => setBanner(message(error)))}
                >
                  <strong>{scenario.name}</strong>
                  <small>
                    Normal {scenario.latest.normal?.businessStatus ?? "—"} · Modified {scenario.latest.modified?.businessStatus ?? "—"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {client && scenarios.length === 0 ? (
            <p className="empty-copy">No scenarios on this machine yet. Create one, or import a JSON file.</p>
          ) : null}
        </nav>
        ) : null}

        {draft && client ? (
          <section className="studio">
            <div className="studio-head">
              <label className="name">
                Scenario
                <input value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <div className="tabs" role="tablist" aria-label="Flows">
                {(["normal", "modified"] as const).map((id) => {
                  const count = draft.variants.find((item) => item.id === id)?.deliveries.length ?? 0;
                  return (
                    <button key={id} type="button" role="tab" aria-selected={variant === id} onClick={() => switchVariant(id)}>
                      {id === "normal" ? "Normal" : "Modified"} ({count})
                    </button>
                  );
                })}
              </div>
              {variant === "modified" ? (
                <button type="button" onClick={() => setDraft(copyNormalIntoModified(draft))}>
                  Copy normal into modified
                </button>
              ) : null}
            </div>
            <DeliveryCards
              scenario={draft}
              variantId={variant}
              selectedId={selectedDeliveryId}
              onSelect={(id) => {
                setSelectedDeliveryId(id);
                setJsonError(null);
              }}
              onReorder={(from, to) => setDraft(moveDelivery(draft, variant, from, to))}
              onDuplicate={(id) => {
                const before = new Set(draft.variants.find((item) => item.id === variant)?.deliveries.map((item) => item.id));
                const next = duplicateDelivery(draft, variant, id);
                setDraft(next);
                const created = next.variants.find((item) => item.id === variant)?.deliveries.find((item) => !before.has(item.id));
                if (created) setSelectedDeliveryId(created.id);
              }}
              onRemove={(id) => {
                const next = removeDelivery(draft, variant, id);
                setDraft(next);
                if (selectedDeliveryId === id) {
                  setSelectedDeliveryId(sortDeliveries(next.variants.find((item) => item.id === variant)?.deliveries ?? [])[0]?.id ?? null);
                }
              }}
              onMove={(id, direction) => {
                const visual = sortDeliveries(draft.variants.find((item) => item.id === variant)?.deliveries ?? []);
                const index = visual.findIndex((item) => item.id === id);
                setDraft(moveDelivery(draft, variant, index, index + direction));
              }}
              onDelay={(id, atMs) => setDraft(setDeliveryTime(draft, variant, id, atMs))}
            />
            {profile ? (
              <details className="profile-form">
                <summary>Edit this machine's target</summary>
                <ProfileForm key={profile.id} profile={profile} onSave={(next) => void onSaveProfile(next)} />
              </details>
            ) : null}
          </section>
        ) : (
          <section className="studio" aria-busy="true">
            <p className="sr-only">Loading scenarios</p>
            <div className="skeleton" />
            <div className="skeleton block gap" />
            <div className="skeleton block gap" />
          </section>
        )}

        {draft ? (
          <Inspector
            scenario={draft}
            variantId={variant}
            deliveryId={selectedDeliveryId}
            onChange={setDraft}
            onJsonError={setJsonError}
          />
        ) : null}
      </main>

      <Results
        runs={runs}
        comparison={comparison}
        history={history}
        onOpenHistory={(id, variantId) => {
          if (!client) return;
          void client.getRun(id).then((run) => setRuns((current) => ({ ...current, [variantId]: run }))).catch((error: unknown) => setBanner(message(error)));
        }}
      />

      {discardTarget && client ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="discard-title">
            <h2 id="discard-title">Discard unsaved edits?</h2>
            <p>The copy on this machine stays at the last save. This does not run the scenario.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDiscardTarget(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const nextId = discardTarget;
                  setDiscardTarget(null);
                  void openScenario(client, nextId, false).catch((error: unknown) => setBanner(message(error)));
                }}
              >
                Discard edits
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {preview && draft ? (
        <RunPreview
          scenario={draft}
          variant={variant}
          webhookUrl={profile ? `${profile.baseUrl}${profile.webhookPath}` : "No target profile"}
          busy={busy}
          onClose={() => setPreview(false)}
          onRun={(reset) => void onRun(reset)}
        />
      ) : null}
    </div>
  );

  function switchVariant(next: VariantId) {
    setVariant(next);
    const first = sortDeliveries(draft?.variants.find((item) => item.id === next)?.deliveries ?? [])[0];
    setSelectedDeliveryId(first?.id ?? null);
  }

  async function onSave() {
    if (!client || !selectedId || !draft) return;
    setBusy(true);
    try {
      await save(client, selectedId, draft);
    } catch (error) {
      setBanner(message(error));
    } finally {
      setBusy(false);
    }
  }

  function onExport() {
    if (!draft) return;
    try {
      const portable = validateScenario(draft);
      const blob = new Blob([`${JSON.stringify(portable, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${slug(portable.name)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setBanner(message(error));
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !client) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const detail = await client.createScenario(parsed);
      await refreshList(client);
      await openScenario(client, detail.id, true);
    } catch (error) {
      setBanner(message(error));
    }
  }

  async function onCreate() {
    if (!client) return;
    try {
      const detail = await client.createScenario(blankScenario());
      await refreshList(client);
      await openScenario(client, detail.id, true);
    } catch (error) {
      setBanner(message(error));
    }
  }

  async function onSaveProfile(next: Profile) {
    if (!client) return;
    try {
      const savedProfile = await client.saveProfile(next);
      setProfiles((current) => current.map((item) => (item.id === savedProfile.id ? savedProfile : item)));
    } catch (error) {
      setBanner(message(error));
    }
  }

  async function onCancel() {
    if (!client) return;
    const run = runs.normal?.status === "running" ? runs.normal : runs.modified?.status === "running" ? runs.modified : null;
    if (!run) return;
    try {
      await client.cancelRun(run.id);
    } catch (error) {
      setBanner(message(error));
    }
  }

  async function onRun(reset: boolean) {
    if (!client || !selectedId || !draft || !profile) return;
    setBusy(true);
    try {
      let id = selectedId;
      let current = draft;
      if (dirty) {
        const detail = await save(client, selectedId, draft);
        id = detail.id;
        current = detail.document;
      }
      const run = await client.startRun(id, { variantId: variant, reset, targetProfileId: current.targetProfile });
      setPreview(false);
      follow(client, run);
      window.document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setBanner(message(error));
    } finally {
      setBusy(false);
    }
  }
}

function ProfileForm(props: { profile: Profile; onSave: (profile: Profile) => void }) {
  const [baseUrl, setBaseUrl] = useState(props.profile.baseUrl);
  const [webhookPath, setWebhookPath] = useState(props.profile.webhookPath);
  const [label, setLabel] = useState(props.profile.label);
  return (
    <form
      className="profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave({ ...props.profile, label, baseUrl, webhookPath });
      }}
    >
      <h3>This machine</h3>
      <label>
        Label
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label>
        Base URL
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <label>
        Webhook path
        <input value={webhookPath} onChange={(event) => setWebhookPath(event.target.value)} />
      </label>
      <p className="hint">The scenario file stores the profile id, not this URL.</p>
      <button type="submit">Save target</button>
    </form>
  );
}

function RunPreview(props: {
  scenario: Scenario;
  variant: VariantId;
  webhookUrl: string;
  busy: boolean;
  onClose: () => void;
  onRun: (reset: boolean) => void;
}) {
  const deliveries = props.scenario.variants.find((item) => item.id === props.variant)?.deliveries ?? [];
  const stateUrl = props.scenario.verification ? props.scenario.verification.statePath : null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="run-title">Run {props.variant} flow</h2>
        <p>
          {deliveries.length} POST {deliveries.length === 1 ? "delivery" : "deliveries"} to <code>{props.webhookUrl}</code>
        </p>
        <ol className="preview-list">
          {deliveries
            .slice()
            .sort((left, right) => left.atMs - right.atMs)
            .map((delivery) => (
              <li key={delivery.id}>
                <span>{delivery.eventKey}</span>
                <span>{delivery.atMs} ms</span>
              </li>
            ))}
        </ol>
        {stateUrl ? (
          <p>
            After every delivery responds or times out, hook-stage polls <code>{stateUrl}</code> and checks the assertions on that
            one response.
          </p>
        ) : (
          <p>No verification is configured. The business result will be UNVERIFIED.</p>
        )}
        {props.scenario.reset ? (
          <p>
            Fixture reset is <code>POST {props.scenario.reset.path}</code>. hook-stage does not wipe application data unless you
            confirm this hook.
          </p>
        ) : (
          <p>This scenario has no reset hook, so the run will not be marked as a clean start.</p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          {props.scenario.reset ? (
            <button type="button" className="primary" disabled={props.busy} autoFocus onClick={() => props.onRun(true)}>
              Reset fixture and run
            </button>
          ) : null}
          <button type="button" disabled={props.busy} onClick={() => props.onRun(false)}>
            Run without reset
          </button>
        </div>
      </div>
    </div>
  );
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scenario";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
