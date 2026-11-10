import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { Badge, EmptyState, Panel, SearchField, SelectField } from '../../../components/ui';
import { cellText, easternTime, filterGames, isSeriesFair, sortGames } from './upcoming';
import { useSends } from '../../bets/SendsContext';
import { hockeyTradingGame, tradingColumns } from '../../suggestions/tradingGames';
import './lol.css';

function Cell({ row, column }) {
  const value = row[column.key];
  if (value == null || value === '') return <span className="muted">—</span>;
  if (column.type === 'image') return <img src={value} alt="" width="20" height="20" loading="lazy" referrerPolicy="no-referrer" />;
  if (column.type === 'link') return <a href={value} target="_blank" rel="noreferrer">Lineup source ↗</a>;
  return cellText(row, column);
}

function useGamePublication(path, label, refresh) {
  const [result, setResult] = useState({ data: null, loading: Boolean(path), error: '' });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let active = true;
    setResult({ data: null, loading: true, error: '' });
    async function load() {
      try {
        const response = await fetch(path, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) throw new Error('Your sign-in has expired. Reload the page to sign in again.');
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.message || `Unable to load ${label}. Try refreshing shortly.`);
        }
        const data = await response.json();
        if (!Array.isArray(data.games) || !Array.isArray(data.columns)) throw new Error(`The ${label} response could not be read.`);
        if (active) setResult({ data, loading: false, error: '' });
      } catch (failure) {
        if (active && failure.name !== 'AbortError') {
          setResult({ data: null, loading: false, error: failure.message || `Unable to load ${label}.` });
        }
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [path, label, refresh]);
  return result;
}

function publicationTime(data) {
  return `${data?.source?.updatedAt ? `Model published ${easternTime(data.source.updatedAt)}` : 'Publication time unavailable'}${data?.fetchedAt ? ` · Fetched ${easternTime(data.fetchedAt)}` : ''}`;
}

function GameCell({ row, column, selectGame }) {
  const fair = isSeriesFair(row, column);
  const goalie = row.sport === 'hockey' && { team_a: row.goalie_team, team_b: row.goalie_opp }[column.key];
  const className = [
    ['odds', 'number', 'percent'].includes(column.type) && 'lol-numeric',
    fair && 'lol-series-fair',
    ['market_prices', 'edge'].includes(column.key) && 'trading-market-cell',
    column.key === 'edge' && row.best_edge > 0 && 'trading-positive-edge',
  ].filter(Boolean).join(' ');
  return <td className={className} title={fair ? `${row.series_format} XGB fair for Team A` : column.key === 'series_format' && row.sport !== 'hockey' ? 'Format inferred from the number of unique maps in the published match.' : undefined}>
    {column.key === 'team_a' ? <button className="game-market-button" type="button" aria-label={`Select markets for ${row.team_a} vs ${row.team_b}`} onClick={() => selectGame(row)}><Cell row={row} column={column} /></button> : <Cell row={row} column={column} />}
    {goalie && <small className="trading-goalie">{goalie}</small>}
  </td>;
}

export default function LolUpcomingGames({ trading = false }) {
  const { openGame } = useSends();
  const [refresh, setRefresh] = useState(0);
  const [league, setLeague] = useState('ALL');
  const [lastLineup, setLastLineup] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: 'begin_at', direction: 'asc' });
  const [pageSize, setPageSize] = useState('200');
  const [page, setPage] = useState(0);
  const lol = useGamePublication('/api/lol/upcoming-games', 'upcoming games', refresh);
  const hockey = useGamePublication(trading ? '/api/hockey/future-games' : null, 'hockey Future Games', refresh);
  const data = lol.data;
  const hockeyData = trading ? hockey.data : null;
  const loading = lol.loading || (trading && hockey.loading);
  const ready = Boolean(data || hockeyData);
  const games = useMemo(() => [
    ...(data?.games || []).map(game => ({
      ...game, publishedAt: data.source?.updatedAt || '',
      ...(trading ? { sport_label: 'League of Legends', edge: 'Unavailable' } : {}),
    })),
    ...(hockeyData?.games || []).map(game => hockeyTradingGame(game, hockeyData.source?.updatedAt)),
  ], [data, hockeyData, trading]);
  const columns = trading ? tradingColumns : data?.columns;
  const leagues = useMemo(() => [...new Set(games.map(row => row.league).filter(Boolean))].sort(), [games]);
  const visible = useMemo(() => {
    const filtered = filterGames(games, columns || [], { league, lastLineup, search, filters });
    const column = trading && sort.key === 'edge' ? { key: 'best_edge', type: 'number' } : columns?.find(column => column.key === sort.key);
    return sortGames(filtered, column, sort.direction);
  }, [games, columns, league, lastLineup, search, filters, sort, trading]);
  const totalPages = Math.max(1, Math.ceil(visible.length / Number(pageSize)));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = visible.slice(currentPage * Number(pageSize), (currentPage + 1) * Number(pageSize));
  const selectGame = row => openGame(row);

  function changeFilter(setter, value) {
    setter(value);
    setPage(0);
  }
  function changeSort(key) {
    const direction = sort.key === key ? (sort.direction === 'asc' ? 'desc' : 'asc') : key === 'edge' ? 'desc' : 'asc';
    setSort({ key, direction });
    setPage(0);
  }

  return <>
    <Panel>
      <div className="panel-controls lol-controls">
        <div className="filter-row">
          <Badge tone={ready && !loading ? 'green' : 'neutral'}>{loading ? 'Loading…' : !ready ? 'Data unavailable' : trading && !(data && hockeyData) ? 'One source connected' : 'Database connected'}</Badge>
          <button className="button button-secondary" type="button" disabled={loading} onClick={() => { setRefresh(value => value + 1); setPage(0); }}><Icon name="refresh" size={16} />{loading ? 'Loading…' : 'Refresh data'}</button>
          <SelectField label="League" value={league} onChange={value => changeFilter(setLeague, value)} options={[{ value: 'ALL', label: 'All leagues' }, ...leagues.map(value => ({ value, label: value }))]} />
          <label className="lol-checkbox"><input type="checkbox" checked={lastLineup} onChange={event => changeFilter(setLastLineup, event.target.checked)} />{trading ? 'Only show last confirmed LoL lineup' : 'Only show last confirmed lineup'}</label>
          <SearchField label="Search upcoming games" placeholder="Search teams, players, games…" value={search} onChange={value => changeFilter(setSearch, value)} />
          <SelectField label="Rows per page" value={pageSize} onChange={value => changeFilter(setPageSize, value)} options={['25', '50', '100', '200'].map(value => ({ value, label: value }))} />
          <button type="button" className="button button-secondary" onClick={() => changeFilter(setFilters, {})}>Clear filters</button>
        </div>
      </div>
      {trading && lol.error && <p className="sends-error" role="alert">League of Legends · {lol.error}</p>}
      {trading && hockey.error && <p className="sends-error" role="alert">Hockey · {hockey.error}</p>}
      {!trading && lol.error ? <div role="alert"><EmptyState icon="link" title="Upcoming games unavailable" description={lol.error} /></div>
        : loading && !ready ? <div role="status"><EmptyState icon="game" title="Loading upcoming games" description="Reading the latest published model outputs." /></div>
        : ready && <>
          <div className="table-scroll lol-table-scroll" role="region" aria-label={trading ? "Trading Dashboard games" : "Upcoming games table"} tabIndex={0}>
            <table className="data-table lol-table" aria-label={trading ? "Trading Dashboard" : "League of Legends upcoming games"}><thead>
              <tr>{columns?.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => changeSort(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button></th>)}</tr>
              <tr className="lol-column-filters">{columns?.map(column => <th key={column.key}><input aria-label={`Filter ${column.label}`} value={filters[column.key] || ''} onChange={event => changeFilter(setFilters, { ...filters, [column.key]: event.target.value })} placeholder="Filter…" /></th>)}</tr>
            </thead><tbody>
              {pageRows.map((row, index) => <tr key={`${row.sport || 'lol'}-${row.game_id}-${currentPage}-${index}`} className="game-select-row" onClick={event => { if (!event.target.closest('a, button, input')) selectGame(row); }}>
                {columns?.map(column => <GameCell key={column.key} row={row} column={column} selectGame={selectGame} />)}
              </tr>)}
              {!pageRows.length && <tr><td colSpan={columns?.length || 1}><EmptyState icon="game" title={games?.length ? 'No games match your filters' : 'No upcoming games published'} description={games?.length ? 'Adjust the league, lineup, or column filters to see more games.' : 'New games will appear after the next model publication.'} /></td></tr>}
            </tbody></table>
          </div>
          <div className="lol-pagination"><span>{visible.length ? currentPage * Number(pageSize) + 1 : 0}–{Math.min((currentPage + 1) * Number(pageSize), visible.length)} of {visible.length} rows</span><div><button type="button" className="button button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {totalPages}</span><button type="button" className="button button-secondary" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
        </>}
      <div className="table-footnote lol-source"><Icon name="database" size={15} />{trading ? <>
        {data && <span>LoL · {publicationTime(data)}</span>}
        {hockeyData && <span>Hockey · {publicationTime(hockeyData)}</span>}
        <span>Edges are in percentage points. The LoL feed currently publishes model prices only.</span>
      </> : <span>DigitalOcean · {publicationTime(data)}</span>}</div>
    </Panel>
  </>;
}
