import React, { useEffect, useState } from 'react';
import { Badge, Panel } from '../../components/ui';
import { easternTime } from '../sports/lol/upcoming';
import { feeds, feedLight } from './feedSchedule';

const outcomes = { success: 'Success', no_change: 'No new data', warning: 'Partial coverage', failed: 'Failed' };
function ageText(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${Math.floor(minutes % 60)} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} hr`;
}
function limitText(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  return `${minutes} min`;
}
function durationText(ms) {
  if (ms == null) return '—';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export default function FeedFreshness({ refresh }) {
  const [data, setData] = useState({ runs: [], error: '', loading: true, now: Date.now() });
  useEffect(() => {
    let active = true;
    let pending;
    async function load() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('/api/monitoring/feeds', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.feeds)) throw new Error(payload.message || 'Unable to load feed telemetry.');
        if (active) setData({ runs: payload.feeds, loading: false, error: '', now: Date.now() });
      } catch (error) {
        if (active) setData(current => ({ ...current, loading: false, error: error.name === 'AbortError' ? 'Feed telemetry request timed out.' : error.message, now: Date.now() }));
      } finally { clearTimeout(timeout); pending = null; }
    }
    void load();
    const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); pending?.abort(); };
  }, [refresh]);
  const runs = new Map(data.runs.map(run => [run.id, run]));
  return <Panel title="Data Freshness" description="Collector health by dataset. Ages use the last successful check. Times are Eastern.">
    {data.error && <p className="sends-error" role="alert">{data.error}{data.runs.length ? ' Showing the last retrieved results.' : ''}</p>}
    <div className="table-scroll"><table className="data-table feed-freshness" aria-label="Data freshness by feed">
      <thead><tr>{['Dataset', 'Status', 'Cadence', 'Green / Red limits', 'Last success (ET)', 'Age', 'Latest data (ET)', 'Last run (ET)', 'Run result', 'Duration', 'Volume', 'Reported gaps'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      {['Hockey', 'LoL'].map(sport => <tbody key={sport}>
        <tr className="feed-group"><th scope="rowgroup" colSpan={12}>{sport}</th></tr>
        {feeds.filter(feed => feed.sport === sport).map(feed => {
          const run = runs.get(feed.id);
          const light = feedLight(feed, run, data.now);
          const label = data.loading ? 'Loading…' : data.error && !run ? 'Unavailable' : light.label;
          return <tr key={feed.id}>
            <th scope="row">{feed.name}</th>
            <td><Badge tone={`feed-${light.tone}`}>{label}</Badge></td>
            <td>{feed.cadence}</td>
            <td>≤ {limitText(feed.green)} / &gt; {limitText(feed.yellow)}</td>
            <td>{easternTime(run?.lastSuccessAt)}</td><td>{ageText(light.age)}</td>
            <td>{easternTime(run?.lastDataAt)}</td><td>{easternTime(run?.lastRunAt)}</td>
            <td>{outcomes[run?.status] || '—'}</td><td>{durationText(run?.durationMs)}</td>
            <td>{run?.records == null ? '—' : `${run.records.toLocaleString()} ${run.unit || 'records'}`}</td>
            <td>{run?.gaps?.toLocaleString() ?? '—'}</td>
          </tr>;
        })}
      </tbody>)}
    </table></div>
    <div className="table-footnote">Yellow covers the time between green and red or a recent failed or partial run. Gray means the collector has yet to report.</div>
  </Panel>;
}
