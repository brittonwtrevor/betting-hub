import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import { Badge, EmptyState, Panel, SearchField, SelectField, StatGrid } from '../../../components/ui';
import { cellText, easternTime, filterGames, rowTsv, sortGames } from './upcoming';
import './lol.css';

function Cell({ row, column }) {
  const value = row[column.key];
  if (value == null || value === '') return <span className="muted">—</span>;
  if (column.type === 'image') return <img src={value} alt="" width="20" height="20" loading="lazy" referrerPolicy="no-referrer" />;
  if (column.type === 'link') return <a href={value} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Lineup source ↗</a>;
  return cellText(row, column);
}

export default function LolUpcomingGames() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [league, setLeague] = useState('ALL');
  const [lastLineup, setLastLineup] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: 'begin_at', direction: 'asc' });
  const [pageSize, setPageSize] = useState('200');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [copyStatus, setCopyStatus] = useState('');
  const copyAttempt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setSelected(null);
    setCopyStatus('');
    copyAttempt.current += 1;
    async function load() {
      try {
        const response = await fetch('/api/lol/upcoming-games', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) throw new Error('Your sign-in has expired. Reload the page to sign in again.');
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.message || 'Unable to load upcoming games. Try refreshing shortly.');
        }
        const result = await response.json();
        if (!Array.isArray(result.games) || !Array.isArray(result.columns)) throw new Error('The upcoming games response could not be read.');
        if (active) { setData(result); setPage(0); }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') {
          setError(failure.message || 'Unable to load upcoming games.');
          setData(null);
        }
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  const games = data?.games;
  const columns = data?.columns;
  const leagues = useMemo(() => [...new Set((games || []).map(row => row.league).filter(Boolean))].sort(), [games]);
  const visible = useMemo(() => {
    const filtered = filterGames(games || [], columns || [], { league, lastLineup, search, filters });
    return sortGames(filtered, columns?.find(column => column.key === sort.key), sort.direction);
  }, [games, columns, league, lastLineup, search, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = visible.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
  const tsv = selected ? rowTsv(selected) : '';
  const ready = !!data && !loading;
  const stats = [
    { label: 'Upcoming games', value: ready ? new Set(visible.map(row => row.game_id)).size : undefined, note: 'Unique games in the current filters' },
    { label: 'Leagues', value: ready ? new Set(visible.map(row => row.league)).size : undefined, note: 'Competitions in the current filters' },
    { label: 'Lineup options', value: ready ? visible.length : undefined, note: 'Rows in the current filters' },
    { label: 'Model coverage', value: ready ? `${visible.filter(row => row.xgb_map1 != null).length} / ${visible.length}` : undefined, note: 'Rows with an XGB Map 1 price' },
  ];

  function changeFilter(setter, value) {
    setter(value);
    setPage(0);
    setSelected(null);
    setCopyStatus('');
    copyAttempt.current += 1;
  }

  async function copyRow(row) {
    setSelected(row);
    const attempt = ++copyAttempt.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(rowTsv(row));
      if (attempt === copyAttempt.current) setCopyStatus('Copied to clipboard.');
    } catch {
      if (attempt === copyAttempt.current) setCopyStatus('Select and copy the text below to paste into Google Sheets.');
    }
  }

  return <>
    <div className="sport-intro sport-intro-lol"><div className="sport-intro-icon"><Icon name="game" size={30} /></div><div><p className="eyebrow">SPORTS INTELLIGENCE</p><h2>League of Legends</h2><p>Upcoming games, model prices, and projected lineups.</p></div><Badge tone={ready ? 'green' : 'neutral'}>{loading ? 'Loading…' : ready ? 'Database connected' : 'Data unavailable'}</Badge></div>
    <StatGrid items={stats} />
    <Panel title="Upcoming Games" description="Map and series prices are for Team A. Select a row to copy its match details to Google Sheets."
      action={<button className="button button-secondary" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={16} />{loading ? 'Loading…' : 'Refresh data'}</button>}>
      <div className="panel-controls lol-controls">
        <div className="filter-row">
          <SelectField label="League" value={league} onChange={value => changeFilter(setLeague, value)} options={[{ value: 'ALL', label: 'All leagues' }, ...leagues.map(value => ({ value, label: value }))]} />
          <label className="lol-checkbox"><input type="checkbox" checked={lastLineup} onChange={event => changeFilter(setLastLineup, event.target.checked)} />Only show last confirmed lineup</label>
          <SearchField label="Search upcoming games" placeholder="Search teams, players, games…" value={search} onChange={value => changeFilter(setSearch, value)} />
          <SelectField label="Rows per page" value={pageSize} onChange={value => changeFilter(setPageSize, value)} options={['25', '50', '100', '200'].map(value => ({ value, label: value }))} />
        </div>
        <div className="lol-copy"><div className="lol-copy-label"><label htmlFor="lol-copy-row">Google Sheets row</label><span>Match ID · League · Start time (UTC) · Team A · Team B</span></div><div className="lol-copy-input"><textarea id="lol-copy-row" readOnly rows="2" value={tsv} placeholder="Select a game below to copy its details." onFocus={event => event.target.select()} /><button type="button" className="button button-secondary" disabled={!selected} onClick={() => copyRow(selected)}>Copy row</button></div><p className="lol-copy-status" role="status">{copyStatus}</p></div>
      </div>
      {error ? <div role="alert"><EmptyState icon="link" title="Upcoming games unavailable" description={error} /></div>
        : loading ? <div role="status"><EmptyState icon="game" title="Loading upcoming games" description="Reading the latest published model outputs." /></div>
        : <>
          <div className="table-scroll lol-table-scroll" role="region" aria-label="Upcoming games table" tabIndex={0}>
            <table className="data-table lol-table" aria-label="League of Legends upcoming games"><thead>
              <tr><th scope="col">Select</th>{columns?.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => { setSort({ key: column.key, direction: sort.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0); }}>{column.label}<span aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button></th>)}</tr>
              <tr className="lol-column-filters"><th><button type="button" className="lol-clear" onClick={() => changeFilter(setFilters, {})}>Clear filters</button></th>{columns?.map(column => <th key={column.key}><input aria-label={`Filter ${column.label}`} value={filters[column.key] || ''} onChange={event => changeFilter(setFilters, { ...filters, [column.key]: event.target.value })} placeholder="Filter…" /></th>)}</tr>
            </thead><tbody>
              {pageRows.map((row, index) => <tr key={`${row.game_id}-${currentPage}-${index}`} className={selected === row ? 'lol-selected' : ''} onClick={() => copyRow(row)}>
                <td><button className="button button-secondary lol-row-button" type="button" aria-label={`Copy ${row.team_a} versus ${row.team_b}, game ${row.game_id}, lineup ${currentPage * Number(pageSize) + index + 1}`} aria-pressed={selected === row} onClick={event => { event.stopPropagation(); copyRow(row); }}>Copy</button></td>
                {columns?.map(column => <td key={column.key} className={['odds', 'number', 'percent'].includes(column.type) ? 'lol-numeric' : undefined}><Cell row={row} column={column} /></td>)}
              </tr>)}
              {!pageRows.length && <tr><td colSpan={(columns?.length || 0) + 1}><EmptyState icon="game" title={games?.length ? 'No games match your filters' : 'No upcoming games published'} description={games?.length ? 'Adjust the league, lineup, or column filters to see more games.' : 'New games will appear after the next model publication.'} /></td></tr>}
            </tbody></table>
          </div>
          <div className="lol-pagination"><span>{visible.length ? currentPage * Number(pageSize) + 1 : 0}–{Math.min((currentPage + 1) * Number(pageSize), visible.length)} of {visible.length} rows</span><div><button type="button" className="button button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {totalPages}</span><button type="button" className="button button-secondary" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
        </>}
      <div className="table-footnote lol-source"><Icon name="database" size={15} /><span>DigitalOcean · {data?.source?.updatedAt ? `Model published ${easternTime(data.source.updatedAt)}` : 'Publication time unavailable'}{data?.fetchedAt && ` · Fetched ${easternTime(data.fetchedAt)}`}</span></div>
    </Panel>
  </>;
}
