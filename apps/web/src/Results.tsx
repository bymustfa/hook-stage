import type { Comparison, RunSummary, RunView, VariantId } from "@hook-stage/scenario";

export function Results(props: {
  runs: { normal: RunView | null; modified: RunView | null };
  comparison: Comparison;
  history: RunSummary[];
  onOpenHistory: (id: string, variantId: VariantId) => void;
}) {
  return (
    <section className="results" id="results" aria-label="Run results">
      <div className={props.comparison.comparable ? "compare ok" : "compare"}>
        <strong>{props.comparison.comparable ? "Comparable" : "Not a paired comparison"}</strong>
        <span>{props.comparison.reason}</span>
      </div>
      <div className="result-grid">
        <RunColumn title="Normal flow" run={props.runs.normal} />
        <RunColumn title="Modified flow" run={props.runs.modified} />
      </div>
      {props.history.length > 0 ? (
        <div className="history">
          <span>History</span>
          {props.history.slice(0, 8).map((run) => (
            <button key={run.id} type="button" onClick={() => props.onOpenHistory(run.id, run.variantId)}>
              {run.variantId} · {run.businessStatus ?? run.status}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunColumn(props: { title: string; run: RunView | null }) {
  const run = props.run;
  if (!run) {
    return (
      <article className="run">
        <h3>{props.title}</h3>
        <div className="empty-copy">
          <p>No run yet.</p>
          <p>Run this flow to see the HTTP result and the business result side by side.</p>
        </div>
      </article>
    );
  }
  const httpOk = run.httpSummary === "all 2xx";
  const business = (run.businessStatus ?? "pending").toLowerCase();
  return (
    <article className="run">
      <header>
        <h3>{props.title}</h3>
        <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleTimeString()}</time>
      </header>
      {httpOk && run.businessStatus === "FAIL" ? (
        <p className="callout">Every request succeeded. The business outcome did not.</p>
      ) : null}
      <p className="headline" aria-live="polite">
        {run.headline ?? (run.status === "running" ? "Running…" : run.error ?? run.status)}
      </p>
      <div className="chips">
        <span className={httpOk ? "chip pass" : "chip neutral"}>HTTP {run.httpSummary ?? "…"}</span>
        <span className={`chip business-${business}`}>Business {run.businessStatus ?? "…"}</span>
        <span className="chip">{run.cleanStart ? "Clean start" : "Not a clean start"}</span>
      </div>
      {run.error ? <p className="field-error">{run.error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Event</th>
              <th>Event id</th>
              <th>Planned</th>
              <th>Actual</th>
              <th>HTTP</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {run.deliveries.map((delivery) => (
              <tr key={delivery.deliveryId}>
                <td>{delivery.position + 1}</td>
                <td>{delivery.eventKey}</td>
                <td className="mono">{delivery.eventId ?? "—"}</td>
                <td className="mono">{delivery.plannedAtMs} ms</td>
                <td className="mono">{delivery.actualAtMs === null ? "—" : `${delivery.actualAtMs} ms`}</td>
                <td>{delivery.httpStatus ?? delivery.outcome}</td>
                <td className="mono">{delivery.latencyMs === null ? "—" : `${delivery.latencyMs} ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {run.assertions.length > 0 ? (
        <ul className="assertion-results">
          {run.assertions.map((assertion) => (
            <li key={`${assertion.position}-${assertion.pointer}`} className={assertion.passed ? "pass" : "fail"}>
              <strong>{assertion.passed ? "PASS" : "FAIL"}</strong>
              <span>{assertion.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {run.observedState ? (
        <details>
          <summary>Observed state</summary>
          <pre>{JSON.stringify(run.observedState, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

