import React, { useEffect, useState } from 'react';
import { Badge, Panel } from '../../components/ui';
import { easternTime } from '../sports/lol/upcoming';
import { models, staleHours, summarizeModel } from './modelCoverage';

export function useModelCoverage() {
  const [results, setResults] = useState({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 25000);
    setResults({});
    const requests = Object.entries(models).map(async ([id, model]) => {
      let result;
      try {
        const response = await fetch(model.endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.games)) throw new Error(payload.message || 'Unable to read model output.');
        result = summarizeModel(model, payload);
      } catch (error) {
        result = { status: 'Unavailable', error: error.name === 'AbortError' ? 'The output check timed out.' : error.message };
      }
      if (active) setResults(current => ({ ...current, [id]: result }));
    });
    void Promise.all(requests).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [refresh]);
  return { results, reload: () => setRefresh(value => value + 1) };
}

export function ModelCoverage({ model, result }) {
  return <Panel title={`${model.label} data coverage`} description="Upcoming games in the latest published output and the feeds behind it."
    action={<Badge tone={result?.status === 'Published' ? 'green' : 'neutral'}>{result?.status || 'Checking output…'}</Badge>}>
    {result?.coverage && <>
      <div className="table-footnote">{result.count.toLocaleString()} upcoming {model.unit} · Published {easternTime(result.updatedAt)} · Stale after {staleHours} hours</div>
      <div className="table-scroll"><table className="data-table" aria-label={`${model.label} coverage by league`}>
        <thead><tr><th scope="col">League</th><th scope="col">Upcoming</th>{model.metrics.map(metric => <th key={metric} scope="col">{metric}</th>)}</tr></thead>
        <tbody>{result.coverage.map(row => <tr key={row.league}><th scope="row">{row.league}</th><td>{row.count}</td>{row.counts.map((count, index) => <td key={model.metrics[index]}>{count} / {row.count}</td>)}</tr>)}
          {!result.coverage.length && <tr><td colSpan={model.metrics.length + 2}>No upcoming {model.unit} in this publication.</td></tr>}
        </tbody>
      </table></div>
    </>}
    <div className="table-scroll"><table className="data-table" aria-label={`${model.label} source inventory`}>
      <thead><tr><th scope="col">Feed</th><th scope="col">Role</th><th scope="col">Data collected</th></tr></thead>
      <tbody>{model.inputs.map(([name, role, detail]) => <tr key={name}><th scope="row">{name}</th><td>{role}</td><td className="monitoring-input-detail">{detail}</td></tr>)}</tbody>
    </table></div>
  </Panel>;
}
