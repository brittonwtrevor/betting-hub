import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { Badge, EmptyState, Panel, SearchField, SelectField } from '../../../components/ui';
import { cellText, easternTime, filterGames, isSeriesFair, sortGames } from './upcoming';
import { useSends } from '../../bets/SendsContext';
import './lol.css';

function Cell({ row, column }) {
  const value = row[column.key];
  if (value == null || value === '') return <span className="muted">—</span>;
  if (column.type === 'image') return <img src={value} alt="" width="20" height="20" loading="lazy" referrerPolicy="no-referrer" />;
  if (column.type === 'link') return <a href={value} target="_blank" rel="noreferrer">Lineup source ↗</a>;
  return cellText(row, column);
}

export default function LolUpcomingGames({ trading = false }) {
  const { openGame } = useSends();
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

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
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

  const games = useMemo(() => data?.games.map(game => ({ ...game, sport_label: 'League of Legends' })), [data]);
  const columns = useMemo(() => trading ? [
    { key: 'series_format', label: 'Format', type: 'text' },
    { key: 'sport_label', label: 'Sport', type: 'text' },
    ...(data?.columns || []).filter(column => ['begin_at', 'league', 'team_a', 'team_b', 'xgb_map1', 'bo3_price', 'bo5_price'].includes(column.key)),
  ] : data?.columns, [data, trading]);
  const leagues = useMemo(() => [...new Set((games || []).map(row => row.league).filter(Boolean))].sort(), [games]);
  const visible = useMemo(() => {
    const filtered = filterGames(games || [], columns || [], { league, lastLineup, search, filters });
    return sortGames(filtered, columns?.find(column => column.key === sort.key), sort.direction);
  }, [games, columns, league, lastLineup, search, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = visible.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
  const ready = !!data && !loading;


  const selectGame = row => openGame({ ...row, publishedAt: data?.source?.updatedAt || '' });

  function changeFilter(setter, value) {
    setter(value);
    setPage(0);
  }

  return <>
    <Panel>
      <div className="panel-controls lol-controls">
        <div className="filter-row">
          <Badge tone={ready ? 'green' : 'neutral'}>{loading ? 'Loading…' : ready ? 'Database connected' : 'Data unavailable'}</Badge>
          <button className="button button-secondary" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" size={16} />{loading ? 'Loading…' : 'Refresh data'}</button>
          <SelectField label="League" value={league} onChange={value => changeFilter(setLeague, value)} options={[{ value: 'ALL', label: 'All leagues' }, ...leagues.map(value => ({ value, label: value }))]} />
          <label className="lol-checkbox"><input type="checkbox" checked={lastLineup} onChange={event => changeFilter(setLastLineup, event.target.checked)} />Only show last confirmed lineup</label>
          <SearchField label="Search upcoming games" placeholder="Search teams, players, games…" value={search} onChange={value => changeFilter(setSearch, value)} />
          <SelectField label="Rows per page" value={pageSize} onChange={value => changeFilter(setPageSize, value)} options={['25', '50', '100', '200'].map(value => ({ value, label: value }))} />
          <button type="button" className="button button-secondary" onClick={() => changeFilter(setFilters, {})}>Clear filters</button>
        </div>
      </div>
      {error ? <div role="alert"><EmptyState icon="link" title="Upcoming games unavailable" description={error} /></div>
        : loading ? <div role="status"><EmptyState icon="game" title="Loading upcoming games" description="Reading the latest published model outputs." /></div>
        : <>
          <div className="table-scroll lol-table-scroll" role="region" aria-label={trading ? "Trading Dashboard games" : "Upcoming games table"} tabIndex={0}>
            <table className="data-table lol-table" aria-label={trading ? "Trading Dashboard" : "League of Legends upcoming games"}><thead>
              <tr>{columns?.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => { setSort({ key: column.key, direction: sort.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0); }}>{column.label}<span aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button></th>)}</tr>
              <tr className="lol-column-filters">{columns?.map(column => <th key={column.key}><input aria-label={`Filter ${column.label}`} value={filters[column.key] || ''} onChange={event => changeFilter(setFilters, { ...filters, [column.key]: event.target.value })} placeholder="Filter…" /></th>)}</tr>
            </thead><tbody>
              {pageRows.map((row, index) => <tr key={`${row.game_id}-${currentPage}-${index}`} className="game-select-row" onClick={event => { if (!event.target.closest('a, button, input')) selectGame(row); }}>
                {columns?.map(column => <td key={column.key} className={[['odds', 'number', 'percent'].includes(column.type) ? 'lol-numeric' : '', isSeriesFair(row, column) ? 'lol-series-fair' : ''].filter(Boolean).join(' ')} title={isSeriesFair(row, column) ? `${row.series_format} XGB fair for Team A` : column.key === 'series_format' ? 'Format inferred from the number of unique maps in the published match.' : undefined}>{column.key === 'team_a' ? <button className="game-market-button" type="button" aria-label={`Select markets for ${row.team_a} vs ${row.team_b}`} onClick={() => selectGame(row)}><Cell row={row} column={column} /></button> : <Cell row={row} column={column} />}</td>)}
              </tr>)}
              {!pageRows.length && <tr><td colSpan={columns?.length || 1}><EmptyState icon="game" title={games?.length ? 'No games match your filters' : 'No upcoming games published'} description={games?.length ? 'Adjust the league, lineup, or column filters to see more games.' : 'New games will appear after the next model publication.'} /></td></tr>}
            </tbody></table>
          </div>
          <div className="lol-pagination"><span>{visible.length ? currentPage * Number(pageSize) + 1 : 0}–{Math.min((currentPage + 1) * Number(pageSize), visible.length)} of {visible.length} rows</span><div><button type="button" className="button button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {totalPages}</span><button type="button" className="button button-secondary" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
        </>}
      <div className="table-footnote lol-source"><Icon name="database" size={15} /><span>DigitalOcean · {data?.source?.updatedAt ? `Model published ${easternTime(data.source.updatedAt)}` : 'Publication time unavailable'}{data?.fetchedAt && ` · Fetched ${easternTime(data.fetchedAt)}`}</span></div>
    </Panel>
  </>;
}
