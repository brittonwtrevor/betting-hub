import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AnalyticsPage from './AnalyticsPage';
import { periodBounds } from './partnerResults';

const hockeyBet = {
  partnerId: 'partner-a', partnerName: 'Original name', betDate: '2026-11-08',
  gradedAt: '2026-11-10T02:00:00.000Z', sport: 'hockey', league: 'NCAA', odds: -110,
};
const bets = [
  { ...hockeyBet, id: 'win', partnerId: 'legacy-a', status: 'WIN', stake: 110, settledProfit: 100 },
  { ...hockeyBet, id: 'loss', status: 'LOSS', stake: 50, settledProfit: -50 },
  { ...hockeyBet, id: 'void', status: 'VOID', stake: 200, settledProfit: 0 },
  { ...hockeyBet, id: 'partial', status: 'PARTRETURN', stake: 20, settledProfit: -5 },
  { ...hockeyBet, id: 'open-a', status: 'UNGRADED', stake: 55, settledProfit: null },
  { id: 'open-b', partnerId: 'telegram:2', partnerName: 'Partner B', betDate: '2026-11-08',
    status: 'UNGRADED', stake: 40, odds: 150, sport: 'lol', league: 'LCK' },
];

beforeEach(() => {
  global.fetch = jest.fn(async url => ({
    ok: true,
    json: async () => url === '/api/confirms/bets'
      ? { bets }
      : { partners: [{ id: 'partner-a', name: 'Partner A', legacyIds: ['legacy-a'] }] },
  }));
});
afterEach(() => { delete global.fetch; });

test('breaks out settled P/L and open exposure by partner using saved Confirms', async () => {
  render(<AnalyticsPage />);
  const row = await screen.findByRole('row', { name: /^Partner A / });
  expect(within(row).getAllByRole('cell').map(cell => cell.textContent))
    .toEqual(['4', '$380.00', '1', '1', '1', '1', '50%', '$45.00', '25%']);
  fireEvent.click(screen.getByRole('button', { name: 'Unsettled' }));
  const open = screen.getByRole('table', { name: 'Unsettled bets by partner' });
  expect(within(open).queryByRole('columnheader', { name: 'Net P/L' })).not.toBeInTheDocument();
  expect(within(open).getByRole('row', { name: 'Partner A 1 $55.00 $50.00' })).toBeInTheDocument();
  expect(within(open).getByRole('row', { name: 'Partner B 1 $40.00 $60.00' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'hockey' } });
  fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'partner-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'League' }));
  const leagues = screen.getByRole('table', { name: 'Unsettled bets by league' });
  expect(within(leagues).getByRole('row', { name: 'NCAA 1 $55.00 $50.00' })).toBeInTheDocument();
  expect(within(leagues).queryByRole('row', { name: /^LCK / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Date (ET)' }));
  expect(screen.getByRole('row', { name: /^2026-11-08 / })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Settled' }));
  expect(screen.getByRole('row', { name: /^2026-11-09 / })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Date basis'), { target: { value: 'placed' } });
  expect(screen.getByRole('row', { name: /^2026-11-08 / })).toBeInTheDocument();
});

test('reports fetch failures and refreshes the dashboard from Confirms', async () => {
  fetch.mockImplementationOnce(async url => {
    expect(url).toBe('/api/partners');
    return { ok: true, json: async () => ({ partners: [] }) };
  }).mockImplementationOnce(async () => ({ ok: false, json: async () => ({ message: 'Bet report unavailable.' }) }));
  render(<AnalyticsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Bet report unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh bets' }));
  expect(await screen.findByRole('row', { name: /^Partner A / })).toBeInTheDocument();
});

test('starts Monday-based reporting periods at midnight Eastern', () => {
  expect(periodBounds('week', new Date('2026-11-09T04:59:59Z'))).toEqual(['2026-11-02', '2026-11-08']);
  expect(periodBounds('last-week', new Date('2026-11-09T05:00:00Z'))).toEqual(['2026-11-02', '2026-11-08']);
});
