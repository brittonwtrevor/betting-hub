import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { allMarkets } from './markets';
const game = { sport: 'lol', match_id: '11', game_id: '101', team_a: 'Alpha', team_b: 'Bravo', league: 'LCK', begin_at: '2026-11-05 19:00:00', series_format: 'BO3', xgb_map1: -150, bo3_price: -184, islastlineup: 1 };
const columns = [
  { key: 'series_format', label: 'Format' }, { key: 'begin_at', label: 'Start time (ET)', type: 'date' },
  { key: 'league', label: 'League' }, { key: 'team_a', label: 'Team A' }, { key: 'team_b', label: 'Team B' },
  { key: 'xgb_map1', label: 'XGB Map1', type: 'odds' }, { key: 'bo3_price', label: 'BO3 Price', type: 'odds' },
];
let saved;
let failSave;
function response(data, ok = true) { return { ok, json: async () => data }; }
beforeEach(() => {
  window.history.replaceState(null, '', '/#/sports/lol');
  window.scrollTo = jest.fn();
  window.localStorage.clear();
  window.localStorage.setItem('betting-hub.partner-names.v1', JSON.stringify([{ id: 'sam', name: 'Sam', telegramChannel: '-100123' }]));
  saved = []; failSave = false;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/lol/upcoming-games') return response({ games: [game], columns, source: { updatedAt: '2026-11-04 12:00:00' } });
    const body = options.body && JSON.parse(options.body);
    if (options.method === 'POST') {
      if (failSave) return response({ message: 'Storage unavailable. Try again.' }, false);
      const markets = allMarkets(body.game).filter(market => body.marketIds.includes(market.id)).map(market => ({ ...market, line: market.line || '', playTo: '' }));
      const existing = saved[0];
      saved = [{ ...(existing || { id: 'draft-1', game: body.game, markets: [], recipients: [], notes: '', revision: 0 }), revision: (existing?.revision || 0) + 1, markets: [...(existing?.markets || []), ...markets.filter(market => !existing?.markets.some(old => old.id === market.id))] }];
      return response({ draft: saved[0] });
    }
    if (options.method === 'PATCH') {
      saved = [{ ...body, revision: body.revision + 1 }];
      return response({ draft: saved[0] });
    }
    if (options.method === 'DELETE') { saved = []; return response({ removed: true }); }
    return response({ drafts: saved });
  });
});
afterEach(() => { delete global.fetch; window.localStorage.clear(); });

test('selects markets, edits independent play-to prices and total lines, and persists across page changes', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Select markets for Alpha vs Bravo' }));
  const picker = screen.getByRole('dialog', { name: 'Markets · Alpha vs Bravo' });
  expect(within(picker).getByRole('button', { name: 'Add to Sends' })).toBeDisabled();
  expect(within(picker).getByRole('checkbox', { name: /Alpha Map 4/ })).toBeDisabled();
  expect(within(picker).getByRole('checkbox', { name: 'Alpha -1.5 maps' })).toBeEnabled();
  expect(within(picker).getByRole('checkbox', { name: /Alpha -2.5 maps/ })).toBeDisabled();
  await user.click(within(picker).getByRole('checkbox', { name: 'Alpha ML' }));
  await user.click(within(picker).getByRole('checkbox', { name: 'Kill total over · Map 1', exact: true }));
  await user.click(within(picker).getByRole('button', { name: 'Add to Sends' }));
  await screen.findByText('Markets saved to Sends.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Active Bets', exact: true }));
  const card = await screen.findByRole('article', { name: 'Alpha vs Bravo' });
  expect(screen.getByRole('tab', { name: 'Sends' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Confirms' })).toBeDisabled();
  await user.type(within(card).getByLabelText('Play-to price for Alpha ML'), '-160');
  await user.type(within(card).getByLabelText('Line for Kill total over · Map 1'), '25.5');
  await user.type(within(card).getByLabelText('Play-to price for Kill total over · Map 1'), '+105');
  await user.click(within(card).getByRole('checkbox', { name: /Sam/ }));
  await user.click(within(card).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved[0].markets[0].playTo).toBe('-160'));
  expect(saved[0].markets[1].line).toBe('25.5');
  expect(saved[0].markets[1].playTo).toBe('+105');
  expect(saved[0].recipients[0].telegramChannel).toBe('-100123');
  await user.click(screen.getByRole('link', { name: 'Trading Dashboard', exact: true }));
  await user.click(await screen.findByRole('button', { name: 'Select markets for Alpha vs Bravo' }));
  await user.click(screen.getByRole('checkbox', { name: 'Bravo Map 1', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Add to Sends' }));
  await screen.findByText('Markets saved to Sends.');
  await user.click(screen.getByRole('link', { name: 'Active Bets', exact: true }));
  await screen.findByLabelText('Play-to price for Bravo Map 1');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByLabelText('Play-to price for Alpha ML')).toHaveValue('-160');
  expect(screen.getByLabelText('Line for Kill total over · Map 1')).toHaveValue('25.5');
  await user.click(screen.getByRole('button', { name: 'Remove card' }));
  await screen.findByText('No Sends drafts yet');
  expect(saved).toHaveLength(0);
  expect(fetch.mock.calls.every(([url]) => !url.includes('telegram.org'))).toBe(true);
});

test('failed saves keep market selection open for retry and do not create a draft', async () => {
  const user = userEvent.setup(); failSave = true;
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Select markets for Alpha vs Bravo' }));
  await user.click(screen.getByRole('checkbox', { name: 'Bravo ML' }));
  await user.click(screen.getByRole('button', { name: 'Add to Sends' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.getByRole('checkbox', { name: 'Bravo ML' })).toBeChecked();
  expect(saved).toHaveLength(0);
  failSave = false;
  await user.click(screen.getByRole('button', { name: 'Add to Sends' }));
  await screen.findByText('Markets saved to Sends.');
  expect(saved[0].markets).toHaveLength(1);
});
