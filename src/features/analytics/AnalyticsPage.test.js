import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AnalyticsPage from './AnalyticsPage';
import { periodBounds } from './partnerResults';

const hockeyBet = {
  partnerId: 'partner-a', partnerName: 'Original name', betDate: '2026-11-08',
  gradedAt: '2026-11-10T02:00:00.000Z', sport: 'hockey', league: 'NCAA', odds: -110,
  betId: 'HAR561', event: 'Boston Univ. vs Harvard Univ.',
};
const bets = [
  { ...hockeyBet, id: 'win', partnerId: 'legacy-a', status: 'WIN', stake: 110, settledProfit: 100 },
  { ...hockeyBet, id: 'loss', status: 'LOSS', stake: 50, settledProfit: -50 },
  { ...hockeyBet, id: 'void', status: 'VOID', stake: 200, settledProfit: 0 },
  { ...hockeyBet, id: 'partial', status: 'PARTRETURN', stake: 20, settledProfit: -5 },
  { ...hockeyBet, id: 'open-a', status: 'UNGRADED', stake: 55, settledProfit: null },
  { ...hockeyBet, id: 'win-b', partnerId: 'telegram:2', partnerName: 'Partner B', splitPercent: 25,
    status: 'WIN', stake: 80, settledProfit: 80 },
  { id: 'open-b', partnerId: 'telegram:2', partnerName: 'Partner B', betDate: '2026-11-08',
    status: 'UNGRADED', stake: 40, odds: 150, sport: 'lol', league: 'LCK', splitPercent: 25,
    betId: 'GEN336', event: 'Gen.G vs LYON' },
];

beforeEach(() => {
  global.fetch = jest.fn(async url => ({
    ok: true,
    json: async () => url === '/api/confirms/bets'
      ? { bets }
      : { partners: [{ id: 'partner-a', name: 'Partner A', legacyIds: ['legacy-a'], splitPercent: 50 }] },
  }));
});
afterEach(() => { delete global.fetch; });

test('applies partner splits to settled and open breakdowns, filtered totals, and ROI', async () => {
  render(<AnalyticsPage />);
  const row = await screen.findByRole('row', { name: /^Partner A / });
  const stat = label => screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card').querySelector('.stat-value');
  expect(screen.getByRole('columnheader', { name: 'Split (%)' })).toBeInTheDocument();
  expect(within(row).getAllByRole('cell').map(cell => cell.textContent))
    .toEqual(['4', '$190.00', '1', '1', '1', '1', '50%', '$22.50', '25%']);
  expect(stat('Graded risk')).toHaveTextContent('$210.00');
  expect(stat('Net P/L')).toHaveTextContent('$42.50');
  expect(stat('ROI')).toHaveTextContent('38.6%');
  fireEvent.click(screen.getByRole('button', { name: 'League' }));
  expect(screen.getByRole('row', { name: /^NCAA / })).toHaveTextContent('Mixed');
  fireEvent.click(screen.getByRole('button', { name: 'Partner', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Unsettled' }));
  const open = screen.getByRole('table', { name: 'Unsettled bets by partner' });
  expect(within(open).queryByRole('columnheader', { name: 'Net P/L' })).not.toBeInTheDocument();
  expect(within(open).getByRole('row', { name: 'Partner A 1 $27.50 $25.00' })).toBeInTheDocument();
  expect(within(open).getByRole('row', { name: 'Partner B 1 $10.00 $15.00' })).toBeInTheDocument();
  expect(stat('Open risk')).toHaveTextContent('$37.50');
  expect(stat('Potential profit')).toHaveTextContent('$40.00');

  fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'hockey' } });
  fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'partner-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'League' }));
  const leagues = screen.getByRole('table', { name: 'Unsettled bets by league' });
  expect(within(leagues).getByRole('row', { name: 'NCAA 1 $27.50 $25.00' })).toBeInTheDocument();
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

test('rolls up multiple fills across partners by Bet ID using each partner’s split', async () => {
  render(<AnalyticsPage />);
  await screen.findByRole('row', { name: /^Partner A / });
  fireEvent.click(screen.getByRole('button', { name: 'Bet ID' }));
  const settled = screen.getByRole('table', { name: 'Settled bets by bet id' });
  expect(within(settled).getAllByRole('rowheader')).toHaveLength(1);
  expect(within(settled).getByRole('columnheader', { name: 'Fills' })).toBeInTheDocument();
  const settledRow = within(settled).getByRole('row', { name: /^HAR561 / });
  expect(within(settledRow).getAllByRole('cell').map(cell => cell.textContent))
    .toEqual(['Boston Univ. vs Harvard Univ.', '5', '$210.00', '2', '1', '1', '1', 'Mixed', '$42.50', '38.6%']);

  fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'partner-a' } });
  expect(within(settledRow).getAllByRole('cell').map(cell => cell.textContent))
    .toEqual(['Boston Univ. vs Harvard Univ.', '4', '$190.00', '1', '1', '1', '1', '50%', '$22.50', '25%']);

  fireEvent.change(screen.getByLabelText('Partner'), { target: { value: '*' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unsettled' }));
  const unsettled = screen.getByRole('table', { name: 'Unsettled bets by bet id' });
  expect(within(unsettled).getByRole('row', { name: 'GEN336 Gen.G vs LYON 1 $10.00 $15.00' })).toBeInTheDocument();
  expect(within(unsettled).getByRole('row', { name: 'HAR561 Boston Univ. vs Harvard Univ. 1 $27.50 $25.00' })).toBeInTheDocument();
});

test('starts Monday-based reporting periods at midnight Eastern', () => {
  expect(periodBounds('week', new Date('2026-11-09T04:59:59Z'))).toEqual(['2026-11-02', '2026-11-08']);
  expect(periodBounds('last-week', new Date('2026-11-09T05:00:00Z'))).toEqual(['2026-11-02', '2026-11-08']);
});
