import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { Badge, EmptyState, Panel, SearchField, SelectField } from '../../../components/ui';
import { easternTime } from '../lol/upcoming';
import { cellText, filterGames, sortFutureGames } from './futureGames';
import { useSends } from '../../bets/SendsContext';
import '../lol/lol.css';
import './hockey.css';

export default function HockeyFutureGames() {
  const { openGame } = useSends();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState({ league: 'ALL', search: '', from: '', to: '', homeB2b: 'ALL', awayB2b: 'ALL', goalieFilters: false, minGames: 1, maxLastGame: 40, filters: {} });
  const [sort, setSort] = useState({ key: 'dateTime', direction: 'asc' });
  const [pageSize, setPageSize] = useState('50');
  const [page, setPage] = useState(0);
  const change = (key, value) => { setSelection(current => ({ ...current, [key]: value })); setPage(0); };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    (async () => {
      try {
        const response = await fetch('/api/hockey/future-games', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(response.status === 401 ? 'Your sign-in has expired. Reload the page to sign in again.' : problem.message || 'Unable to load hockey Future Games.');
        }
        const result = await response.json();
        if (!Array.isArray(result.games) || !Array.isArray(result.columns)) throw new Error('The hockey response could not be read.');
        if (active) { setData(result); setPage(0); }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') { setError(failure.message); setData(null); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  const options = useMemo(() => {
    const unique = key => [...new Set((data?.games || []).map(row => row[key]).filter(Boolean))].sort().map(value => ({ value, label: value }));
    return { leagues: unique('leagueName'), home: unique('team_b2b_type'), away: unique('opp_b2b_type') };
  }, [data]);
  const visible = useMemo(() => sortFutureGames(filterGames(data?.games || [], data?.columns || [], selection), data?.columns.find(column => column.key === sort.key), sort.direction), [data, selection, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = visible.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
  const gameCount = useMemo(() => new Set(visible.map(row => row.id)).size, [visible]);

  const selectGame = row => openGame({
    ...row, sport: 'hockey', game_id: row.id, team_a: row.homeTeamName, team_b: row.visitingTeamName,
    league: row.leagueName, begin_at: row.dateTime, publishedAt: data?.source?.updatedAt || '',
  });

  return <Panel title="Future Games" description="Model prices, sportsbook odds, and goalie scenarios.">
    <div className="panel-controls lol-controls hockey-controls">
      <div className="filter-row">
        <Badge tone={data && !loading ? 'green' : 'neutral'}>{loading ? 'Loading…' : data ? 'Database connected' : 'Data unavailable'}</Badge>
        <button className="button button-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={16} />Refresh data</button>
        <SelectField label="League" value={selection.league} onChange={value => change('league', value)} options={[{ value: 'ALL', label: 'All leagues' }, ...options.leagues]} />
        <label className="hockey-field">From (ET)<input type="date" value={selection.from} onChange={event => change('from', event.target.value)} /></label>
        <label className="hockey-field">Through (ET)<input type="date" value={selection.to} onChange={event => change('to', event.target.value)} /></label>
        <SearchField label="Search hockey games" placeholder="Search teams, goalies, games…" value={selection.search} onChange={value => change('search', value)} />
      </div>
      <div className="filter-row">
        <SelectField label="Home B2B" value={selection.homeB2b} onChange={value => change('homeB2b', value)} options={[{ value: 'ALL', label: 'All schedules' }, ...options.home]} />
        <SelectField label="Away B2B" value={selection.awayB2b} onChange={value => change('awayB2b', value)} options={[{ value: 'ALL', label: 'All schedules' }, ...options.away]} />
        <label className="lol-checkbox"><input type="checkbox" checked={selection.goalieFilters} onChange={event => change('goalieFilters', event.target.checked)} />Use goalie filters (both teams)</label>
        <label className="hockey-field">Minimum goalie games<input type="number" min="0" value={selection.minGames} disabled={!selection.goalieFilters} onChange={event => change('minGames', event.target.value)} /></label>
        <label className="hockey-field">Maximum days since last game<input type="number" min="0" value={selection.maxLastGame} disabled={!selection.goalieFilters} onChange={event => change('maxLastGame', event.target.value)} /></label>
        <SelectField label="Rows per page" value={pageSize} onChange={value => { setPageSize(value); setPage(0); }} options={['25', '50', '100', '200'].map(value => ({ value, label: value }))} />
        <button className="button button-secondary" onClick={() => { setSelection({ league: 'ALL', search: '', from: '', to: '', homeB2b: 'ALL', awayB2b: 'ALL', goalieFilters: false, minGames: 1, maxLastGame: 40, filters: {} }); setPage(0); }}>Clear filters</button>
      </div>
    </div>
    {error ? <div role="alert"><EmptyState icon="link" title="Future Games unavailable" description={error} /></div>
      : loading ? <div role="status"><EmptyState icon="hockey" title="Loading Future Games" description="Reading the latest published hockey outputs." /></div>
        : <>
          <div className="table-scroll lol-table-scroll" role="region" aria-label="Hockey Future Games table" tabIndex={0}>
            <table className="data-table lol-table hockey-table"><thead>
              <tr>{data.columns.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort(current => ({ key: column.key, direction: current.key === column.key && current.direction === 'asc' ? 'desc' : 'asc' }))}>{column.label}{sort.key === column.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}</tr>
              <tr className="lol-column-filters">{data.columns.map(column => <th key={column.key}><input aria-label={`Filter ${column.label}`} value={selection.filters[column.key] || ''} onChange={event => change('filters', { ...selection.filters, [column.key]: event.target.value })} /></th>)}</tr>
            </thead><tbody>{pageRows.map((row, index) => <tr key={`${currentPage}-${index}`} className="game-select-row" onClick={event => { if (!event.target.closest('a, button, input')) selectGame(row); }}>{data.columns.map(column => <td key={column.key} className={`${['text', 'date'].includes(column.type) ? '' : 'lol-numeric'} ${column.type === 'edge' && row[column.key] >= 0.05 ? 'hockey-edge-strong' : column.type === 'edge' && row[column.key] >= 0.02 ? 'hockey-edge' : ''}`}>{column.key === 'homeTeamName' ? <button className="game-market-button" type="button" aria-label={`Select markets for ${row.homeTeamName} vs ${row.visitingTeamName}`} onClick={() => selectGame(row)}>{cellText(row, column) || '—'}</button> : cellText(row, column) || '—'}</td>)}</tr>)}
              {!visible.length && <tr><td colSpan={data.columns.length}><EmptyState icon="hockey" title="No matching games" description="Adjust your filters or refresh after the next model publication." /></td></tr>}
            </tbody></table>
          </div>
          <div className="lol-pagination"><span>{gameCount.toLocaleString()} games · {visible.length.toLocaleString()} goalie scenarios</span><div><button className="button button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {totalPages}</span><button className="button button-secondary" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
          <div className="lol-pagination lol-source"><span>Published: {easternTime(data.source?.updatedAt)} · Model export: {easternTime(data.source?.fileModifiedAt)}</span><span>Edges shown in percentage points</span></div>
        </>}
  </Panel>;
}
