import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HockeyFutureGames from './HockeyFutureGames';
import { cellText, filterGames, gameDate, sortFutureGames } from './futureGames';

const columns = [{ key: 'dateTime', label: 'Game time (ET)', type: 'date' }, { key: 'homeTeamName', label: 'Home', type: 'text' }, { key: 'winoddsfulltime', label: 'Home fair ML', type: 'odds' }];
const sample = { id: '1', dateTime: '2026-11-05T01:00:00+0300', leagueName: 'NCAA', homeTeamName: 'Boston University', visitingTeamName: 'Maine', winoddsfulltime: 150, goalie_team_n: 10, goalie_opp_n: 8, goalie_team_last_game: 0, goalie_opp_last_game: 2, team_b2b_type: 'no-b2b', opp_b2b_type: 'road-road' };
afterEach(() => { jest.restoreAllMocks(); });

test('uses Eastern dates across midnight and preserves numeric odds, edges and missing values', () => {
  expect(gameDate(sample)).toBe('2026-11-04');
  expect(cellText(sample, columns[2])).toBe('+150');
  expect(cellText({ edge: 0.07 }, { key: 'edge', type: 'edge' })).toBe('7.0 pp');
  expect(filterGames([sample], columns, { from: '2026-11-04', to: '2026-11-04' })).toHaveLength(1);
  expect(filterGames([sample], columns, { from: '2026-11-05' })).toHaveLength(0);
  expect(filterGames([sample], columns, { goalieFilters: true, minGames: 9 })).toHaveLength(0);
  expect(filterGames([sample], columns, { goalieFilters: true, maxLastGame: 1 })).toHaveLength(0);
  expect(filterGames([sample], columns, { awayB2b: 'no-b2b' })).toHaveLength(0);
  const games = [{ edge: null }, { edge: 0.09 }, { edge: 0.1 }];
  expect(sortFutureGames(games, { key: 'edge', type: 'edge' }, 'desc').map(row => row.edge)).toEqual([0.1, 0.09, null]);
});

test('loads hockey data, filters by league, and refreshes from the server', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ columns, games: [sample, { ...sample, id: '2', leagueName: 'OHL', homeTeamName: 'London' }], source: {} }) });
  render(<HockeyFutureGames />);
  expect(await screen.findByText('Boston University')).toBeInTheDocument();
  expect(screen.getByText('London')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('League'), { target: { value: 'NCAA' } });
  expect(screen.queryByText('London')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Refresh data'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/hockey/future-games');
});

test('shows a useful error and removes old data when a refresh fails', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ columns, games: [sample] }) }).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'Hockey is not published yet.' }) });
  render(<HockeyFutureGames />);
  expect(await screen.findByText('Boston University')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Refresh data'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hockey is not published yet.');
  expect(screen.queryByText('Boston University')).not.toBeInTheDocument();
});
