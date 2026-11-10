import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SuggestionsPage from './SuggestionsPage';
import { SendsProvider } from '../bets/SendsContext';

const lol = {
  columns: [], source: { updatedAt: '2026-11-04T10:00:00Z' },
  games: [['BO3', 'Alpha'], ['BO1', 'Charlie'], ['BO5', 'Delta'], [null, 'Echo']].map(([series_format, team_a], index) => ({
    game_id: index + 1, begin_at: '2026-11-05 19:00:00', league: 'LCK', team_a, team_b: 'Bravo', series_format,
    xgb_map1: -130, bo3_price: -180, bo5_price: -220, islastlineup: 1,
  })),
};
const hockeyGame = {
  id: '1', dateTime: '2026-11-05T19:00:00-05:00', leagueName: 'NHL', homeTeamName: 'Boston', visitingTeamName: 'Toronto',
  goalie_team: 'Home goalie A', goalie_opp: 'Away goalie A', winoddsfulltime: -100, away_winoddsfulltime: 100, HomeML: 150, AwayML: -160,
  Total: 5.5, OverOdds: -110, UnderOdds: -110, edge_home: 0.04, edge_away: -0.06, edge_over: 0.03, edge_under: -0.08,
};
const hockey = {
  columns: [], source: { updatedAt: '2026-11-04T12:00:00Z' },
  games: [
    hockeyGame,
    { ...hockeyGame, goalie_team: 'Home goalie B', winoddsfulltime: -140, away_winoddsfulltime: 140, edge_home: -0.01, edge_over: -0.02, edge_under: -0.03 },
    { ...hockeyGame, id: '2', homeTeamName: 'Detroit', goalie_team: 'Detroit goalie', edge_home: 0.12, edge_over: -0.02 },
    { ...hockeyGame, id: '3', homeTeamName: 'Buffalo', goalie_team: 'Buffalo goalie', HomeML: null, AwayML: null, OverOdds: null, UnderOdds: null },
    { ...hockeyGame, id: '4', homeTeamName: 'Ottawa', edge_home: -0.01, edge_over: -0.02 },
  ],
};
const response = (data, ok = true) => ({ ok, json: async () => data });
const hockeyEndpoint = '/api/hockey/future-games';
const mockPublications = (hockeyResponse = response(hockey)) => {
  global.fetch = jest.fn(async url => url === hockeyEndpoint ? hockeyResponse : response(lol));
};
const rowFor = text => screen.getByText(text, { exact: true }).closest('tr');

afterEach(() => { delete global.fetch; window.localStorage.removeItem('betting-hub.trading-feed.v1'); });

test('shows one hockey row per game and the matching LoL series moneyline', async () => {
  mockPublications();
  render(<SendsProvider><SuggestionsPage /></SendsProvider>);
  await screen.findByText('Database connected');
  const table = screen.getByRole('table', { name: 'Trading Dashboard' });
  const lineup = screen.getByRole('checkbox', { name: 'Only show last confirmed LoL lineup' });
  expect(lineup).toBeChecked();
  expect(within(table).queryByRole('button', { name: /Format|BO3 Price|BO5 Price|XGB Map1/ })).not.toBeInTheDocument();
  expect(within(rowFor('Alpha')).getByRole('img', { name: 'League of Legends' })).toBeInTheDocument();
  expect(within(rowFor('Boston')).getByRole('img', { name: 'Hockey' })).toBeInTheDocument();
  for (const [team, price] of [['Alpha', 180], ['Charlie', 130], ['Delta', 220]]) {
    expect(within(rowFor(team)).getByText(`-${price}`)).toHaveClass('lol-series-fair');
    expect(within(rowFor(team)).getByText(`+${price}`)).toBeInTheDocument();
  }
  expect(within(rowFor('Echo')).getAllByText('—')).toHaveLength(2);
  expect(rowFor('Alpha')).toHaveTextContent('Unavailable');
  expect(rowFor('Ottawa')).toHaveTextContent('No positive edge');
  expect(rowFor('Buffalo')).toHaveTextContent('Unavailable');
  const positive = within(rowFor('Boston')).getByText(/Home ML.*Over 5.5/);
  expect(positive).toHaveTextContent('Home ML · +4.0 pp Over 5.5 · +3.0 pp');
  expect(positive).toHaveClass('trading-positive-edge');
  expect(rowFor('Boston')).toHaveTextContent('-100 to -140');
  expect(rowFor('Boston')).toHaveTextContent('+140 to +100');
  expect(table.tBodies[0].rows).toHaveLength(8);
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter Sport' }), { target: { value: 'Hockey' } });
  expect(table.tBodies[0].rows).toHaveLength(4);
  fireEvent.click(within(table).getByRole('button', { name: 'Edge' }));
  expect(table.tBodies[0].rows[0]).toHaveTextContent('Detroit');
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter Edge' }), { target: { value: 'Over' } });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  fireEvent.click(within(table).getByRole('button', { name: 'Select markets for Boston vs Toronto' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Home goalie: Home goalie A/)).toBeInTheDocument();
  fireEvent.change(dialog.getByRole('combobox', { name: 'Goalie matchup' }), { target: { value: '1' } });
  expect(dialog.getByText(/Home goalie: Home goalie B/)).toBeInTheDocument();
  fetch.mockResolvedValueOnce(response({ draft: { id: 'draft', markets: [] } }));
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Boston ML (Home, incl OT/SO)' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Add to Sends' }));
  await screen.findByText('Markets saved to Sends.');
  const [url, request] = fetch.mock.calls.at(-1);
  expect(url).toBe('/api/send-drafts');
  expect(JSON.parse(request.body)).toMatchObject({ game: { game_id: '1', goalie_team: 'Home goalie B', winoddsfulltime: -140 }, marketIds: ['a:ml'] });
});

test('a failed hockey publication leaves LoL available and Refresh data retries both sources', async () => {
  mockPublications(response({ message: 'Snapshot unavailable.' }, false));
  render(<SuggestionsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Hockey · Snapshot unavailable.');
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  fetch.mockImplementation(async url => response(url === hockeyEndpoint ? hockey : lol));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(await screen.findByText('Database connected')).toBeInTheDocument();
  expect(screen.getByText('-100 to -140')).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/lol/upcoming-games', hockeyEndpoint, '/api/lol/upcoming-games', hockeyEndpoint]);
});

test('saves several leagues by sport and restores the feed settings on remount', async () => {
  const lolWithLeagues = { ...lol, games: lol.games.map((game, index) => ({
    ...game, league: ['Worlds', 'LCK', 'LPL', 'LCP'][index],
  })) };
  const hockeyWithLeagues = { ...hockey, games: hockey.games.map(game => game.homeTeamName === 'Ottawa' ? { ...game, leagueName: 'NCAA' } : game) };
  global.fetch = jest.fn(async url => response(url === hockeyEndpoint ? hockeyWithLeagues : lolWithLeagues));
  const view = render(<SuggestionsPage />);
  await screen.findByText('Database connected');

  const settings = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Feed settings' }));
    return within(screen.getByRole('dialog', { name: 'Feed settings' }));
  };
  let drawer = settings();
  const lolGroup = within(drawer.getByRole('group', { name: 'League of Legends' }));
  const hockeyGroup = within(drawer.getByRole('group', { name: 'Hockey' }));
  fireEvent.click(lolGroup.getByRole('checkbox', { name: 'All leagues' }));
  fireEvent.click(lolGroup.getByRole('checkbox', { name: 'Worlds' }));
  fireEvent.click(lolGroup.getByRole('checkbox', { name: 'LCK' }));
  fireEvent.click(hockeyGroup.getByRole('checkbox', { name: 'All leagues' }));
  fireEvent.click(hockeyGroup.getByRole('checkbox', { name: 'NHL' }));
  fireEvent.click(drawer.getByRole('button', { name: 'Save filters' }));
  for (const team of ['Alpha', 'Charlie', 'Boston']) expect(rowFor(team)).toBeInTheDocument();
  for (const team of ['Echo', 'Delta', 'Ottawa']) expect(screen.queryByText(team)).not.toBeInTheDocument();

  drawer = settings();
  fireEvent.click(drawer.getByRole('checkbox', { name: 'Show Hockey' }));
  fireEvent.click(drawer.getByRole('button', { name: 'Save filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.queryByText('Boston')).not.toBeInTheDocument();
  view.unmount();

  render(<SuggestionsPage />);
  await screen.findByText('Database connected');
  for (const team of ['Alpha', 'Charlie']) expect(rowFor(team)).toBeInTheDocument();
  for (const team of ['Boston', 'Delta']) expect(screen.queryByText(team)).not.toBeInTheDocument();
  drawer = settings();
  fireEvent.click(drawer.getByRole('button', { name: 'Reset to all' }));
  fireEvent.click(drawer.getByRole('button', { name: 'Save filters' }));
  for (const team of ['Boston', 'Ottawa', 'Delta', 'Echo']) expect(rowFor(team)).toBeInTheDocument();
});

test('the toolbar league checkboxes apply immediately and restore selections when returning', async () => {
  const extraLeague = { ...hockeyGame, id: '5', homeTeamName: 'Maine', leagueName: 'NCAA' };
  mockPublications(response({ ...hockey, games: [...hockey.games, extraLeague] }));
  const view = render(<SuggestionsPage />);
  await screen.findByText('Database connected');
  const open = label => fireEvent.click(screen.getByLabelText(`Leagues: ${label}`));
  const checkbox = name => screen.getByRole('checkbox', { name, exact: true });
  open('All leagues');
  expect(checkbox('All leagues')).toBeChecked();
  fireEvent.click(checkbox('NHL'));
  expect(rowFor('Boston')).toBeInTheDocument();
  expect(screen.queryByText('Maine')).not.toBeInTheDocument();
  expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  fireEvent.click(checkbox('LCK'));
  expect(rowFor('Alpha')).toBeInTheDocument();
  expect(checkbox('NHL')).toBeChecked();
  view.unmount();

  render(<SuggestionsPage />);
  await screen.findByText('Database connected');
  expect(screen.queryByText('Maine')).not.toBeInTheDocument();
  open('2 leagues');
  expect(checkbox('NHL')).toBeChecked();
  expect(checkbox('LCK')).toBeChecked();
  expect(checkbox('NCAA')).not.toBeChecked();
  fireEvent.click(checkbox('All leagues'));
  expect(rowFor('Maine')).toBeInTheDocument();
});
