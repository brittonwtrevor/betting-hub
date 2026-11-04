import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LolUpcomingGames from './LolUpcomingGames';
import { easternTime, filterGames, sortGames } from './upcoming';

const columns = [
  { key: 'begin_at', label: 'Start time (ET)', type: 'date' },
  { key: 'league', label: 'League', type: 'text' },
  { key: 'team_a', label: 'Team A', type: 'text' },
  { key: 'team_b', label: 'Team B', type: 'text' },
  { key: 'xgb_map1', label: 'XGB Map1', type: 'odds' },
  { key: 'a_adc', label: 'a adc', type: 'text' },
];
const games = [
  { game_id: 1, match_id: 10, begin_at: '2026-11-05 19:00:00', league: 'LCK', islastlineup: 1, team_a: 'Alpha', team_b: 'Bravo', xgb_map1: 150, a_adc: 'Player A' },
  { game_id: 1, match_id: 10, begin_at: '2026-11-05 19:00:00', league: 'LCK', islastlineup: 0, team_a: 'Alpha', team_b: 'Bravo', xgb_map1: 175, a_adc: 'Previous ADC' },
  { game_id: 2, match_id: 20, begin_at: '2026-11-06 21:00:00', league: 'LPL', islastlineup: 1, team_a: 'Charlie', team_b: 'Delta', xgb_map1: -200 },
  { game_id: 3, match_id: 30, begin_at: '2026-11-07 21:00:00', league: 'LCK', islastlineup: 1, team_a: 'Echo', team_b: 'Foxtrot', xgb_map1: null },
];
const payload = { games, columns, fetchedAt: '2026-11-04T20:00:00Z', source: { updatedAt: '2026-11-04 18:00:00' } };
const response = data => ({ ok: true, json: async () => data });
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(2);

beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(response(payload)); });
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

test('loads from the API, defaults to confirmed lineups, and filters leagues and player columns', async () => {
  const user = userEvent.setup();
  render(<LolUpcomingGames />);
  expect(await screen.findByText('Database connected')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/lol/upcoming-games', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(dataRows()).toHaveLength(3);
  expect(screen.queryByText('Previous ADC')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('League', { selector: 'select' }), 'LCK');
  expect(dataRows()).toHaveLength(2);
  await user.click(screen.getByRole('checkbox'));
  expect(dataRows()).toHaveLength(3);
  await user.type(screen.getByLabelText('Filter a adc'), 'Previous');
  expect(dataRows()).toHaveLength(1);
  expect(screen.getByText('Previous ADC')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await user.type(screen.getByRole('searchbox'), 'Echo');
  expect(dataRows()).toHaveLength(1);
});

test('sorts numeric prices without a copy column or Google Sheets widget', async () => {
  const user = userEvent.setup();
  render(<LolUpcomingGames />);
  await screen.findByText('Database connected');
  await user.click(screen.getByRole('button', { name: /XGB Map1/ }));
  expect(within(dataRows()[0]).getByText('Charlie')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Copy/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Select' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Google Sheets row')).not.toBeInTheDocument();
});

test('refresh failures remove old data before retry', async () => {
  render(<LolUpcomingGames />);
  await screen.findByText('Database connected');
  fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ message: 'Data connection failed.' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('Data connection failed.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  await screen.findByText('Database connected');
  expect(dataRows()).toHaveLength(3);
});

test('distinguishes an empty publication from an empty filter result', async () => {
  const user = userEvent.setup();
  fetch.mockResolvedValueOnce(response({ ...payload, games: [] }));
  render(<LolUpcomingGames />);
  await screen.findByText('No upcoming games published');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  await screen.findByText('Database connected');
  await user.type(screen.getByRole('searchbox'), 'No such team');
  await screen.findByText('No games match your filters');
});

test('pagination reaches every row and resets when filters change', async () => {
  const user = userEvent.setup();
  fetch.mockResolvedValueOnce(response({ ...payload, games: Array.from({ length: 26 }, (_, i) => ({ ...games[0], game_id: i + 1, team_a: `Team ${i + 1}` })) }));
  render(<LolUpcomingGames />);
  await screen.findByText('Database connected');
  await user.selectOptions(screen.getByLabelText('Rows per page'), '25');
  expect(dataRows()).toHaveLength(25);
  await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
  expect(dataRows()).toHaveLength(1);
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'Team 1');
  expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
});

test('unmount aborts its pending request', async () => {
  let signal;
  fetch.mockImplementation((url, options) => { signal = options.signal; return new Promise(() => {}); });
  const view = render(<LolUpcomingGames />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test('formats Eastern dates through DST and handles numeric filters and missing prices', () => {
  expect(easternTime('2026-07-04 19:00:00')).toContain('3:00 PM EDT');
  expect(easternTime('2026-11-05 19:00:00')).toContain('2:00 PM EST');
  expect(easternTime('not a date')).toBe('—');
  const filtered = filterGames(games, columns, { lastLineup: false, filters: { xgb_map1: '+175' } });
  expect(filtered[0].a_adc).toBe('Previous ADC');
  expect(sortGames(games, columns[4], 'desc').at(-1).xgb_map1).toBeNull();
});
