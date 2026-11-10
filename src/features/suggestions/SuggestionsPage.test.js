import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SuggestionsPage from './SuggestionsPage';
import { SendsProvider } from '../bets/SendsContext';

const lol = {
  columns: [], source: { updatedAt: '2026-11-04T10:00:00Z' },
  games: [{ game_id: 1, begin_at: '2026-11-05 19:00:00', league: 'LCK', team_a: 'Alpha', team_b: 'Bravo', series_format: 'BO3', bo3_price: -180, islastlineup: 1 }],
};
const hockeyGame = {
  id: '1', dateTime: '2026-11-05T19:00:00-05:00', leagueName: 'NHL', homeTeamName: 'Boston', visitingTeamName: 'Toronto',
  goalie_team: 'Home goalie A', goalie_opp: 'Away goalie A', winoddsfulltime: 130, HomeML: 150, AwayML: -160,
  Total: 5.5, OverOdds: -110, UnderOdds: -110, edge_home: 0.04, edge_away: -0.06, edge_over: 0.03, edge_under: -0.08,
};
const hockey = {
  columns: [], source: { updatedAt: '2026-11-04T12:00:00Z' },
  games: [
    hockeyGame,
    { ...hockeyGame, goalie_team: 'Home goalie B', edge_home: -0.01, edge_over: -0.02, edge_under: -0.03 },
    { ...hockeyGame, id: '2', homeTeamName: 'Detroit', goalie_team: 'Detroit goalie', edge_home: 0.12, edge_over: -0.02 },
    { ...hockeyGame, id: '3', homeTeamName: 'Buffalo', goalie_team: 'Buffalo goalie', HomeML: null, AwayML: null, OverOdds: null, UnderOdds: null },
  ],
};
const response = (data, ok = true) => ({ ok, json: async () => data });
const hockeyEndpoint = '/api/hockey/future-games';
const mockPublications = (hockeyResponse = response(hockey)) => {
  global.fetch = jest.fn(async url => url === hockeyEndpoint ? hockeyResponse : response(lol));
};
const rowFor = text => screen.getByText(text, { exact: true }).closest('tr');

afterEach(() => { delete global.fetch; });

test('mixes hockey scenarios and LoL, shows priced edges, and opens the selected hockey scenario', async () => {
  mockPublications();
  render(<SendsProvider><SuggestionsPage /></SendsProvider>);
  await screen.findByText('Database connected');
  const table = screen.getByRole('table', { name: 'Trading Dashboard' });
  const lineup = screen.getByRole('checkbox', { name: 'Only show last confirmed LoL lineup' });
  expect(lineup).toBeChecked();
  expect(within(rowFor('Alpha')).getByText('-180')).toHaveClass('lol-series-fair');
  expect(rowFor('Alpha')).toHaveTextContent('Unavailable');
  const scenario = rowFor('Home goalie B');
  expect(scenario).toHaveTextContent('No positive edge');
  expect(rowFor('Buffalo')).toHaveTextContent('Unavailable');
  const positive = within(rowFor('Home goalie A')).getByText(/Home ML.*Over 5.5/);
  expect(positive).toHaveTextContent('Home ML · +4.0 pp Over 5.5 · +3.0 pp');
  expect(positive).toHaveClass('trading-positive-edge');
  expect(rowFor('Home goalie A')).toHaveTextContent('ML · Home +150 / Away -160');
  expect(rowFor('Home goalie A')).toHaveTextContent('Total 5.5 · Over -110 / Under -110');
  fireEvent.click(within(table).getByRole('button', { name: 'Edge' }));
  expect(table.tBodies[0].rows[0]).toHaveTextContent('Detroit');
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter Edge' }), { target: { value: 'Over' } });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  fireEvent.click(within(table).getByRole('button', { name: 'Select markets for Boston vs Toronto' }));
  expect(within(screen.getByRole('dialog')).getByText(/Home goalie: Home goalie A/)).toBeInTheDocument();
});

test('a failed hockey publication leaves LoL available and Refresh data retries both sources', async () => {
  mockPublications(response({ message: 'Snapshot unavailable.' }, false));
  render(<SuggestionsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Hockey · Snapshot unavailable.');
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  fetch.mockImplementation(async url => response(url === hockeyEndpoint ? hockey : lol));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(await screen.findByText('Database connected')).toBeInTheDocument();
  expect(screen.getByText('Home goalie B')).toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/lol/upcoming-games', hockeyEndpoint, '/api/lol/upcoming-games', hockeyEndpoint]);
});
