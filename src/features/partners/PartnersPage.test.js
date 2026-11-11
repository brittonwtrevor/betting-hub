import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnersPage from './PartnersPage';
import { splitAmount, splitToBps } from './split';

const partners = [
  { id: 'a', name: 'Partner A', openExposure: 100, owedToYou: 25, owedToPartner: 0 },
  { id: 'b', name: 'Partner B', openExposure: 200, owedToYou: 0, owedToPartner: 40 },
];
const bets = [
  { id: 'a-bet', partnerId: 'a', event: 'Hockey game', selection: 'Over 5.5', stake: 100, odds: '+110', status: 'Settled', settledProfit: 110, yourShare: 55 },
  { id: 'b-bet', partnerId: 'b', event: 'Race winner', selection: 'Driver B', stake: 200, odds: '+500', status: 'Open' },
];
const payments = [
  { id: 'a-payment', partnerId: 'a', amount: 30, direction: 'Received', reference: 'A transfer', status: 'Complete' },
  { id: 'b-payment', partnerId: 'b', amount: 40, direction: 'Sent', reference: 'B transfer', status: 'Complete' },
];
let persisted;
let reportedBets;
let recordedPayments;
const response = (body, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'new-partner' } });
  persisted = [];
  reportedBets = [];
  recordedPayments = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/confirms/bets') return response({ bets: reportedBets });
    const input = options.body && JSON.parse(options.body);
    if (url.endsWith('/split')) {
      const id = url.split('/').at(-2);
      const bet = reportedBets.find(item => item.id === id);
      const bps = splitToBps(input.splitPercent);
      const saved = { id, revision: bet.revision + 1, splitPercent: input.splitPercent,
        yourRisk: splitAmount(bet.stake, bps), yourShare: splitAmount(bet.settledProfit, bps) };
      reportedBets = reportedBets.map(item => item.id === id ? { ...item, ...saved } : item);
      return response({ bet: saved });
    }
    if (url === '/api/partners/ledger/payments') {
      if (options.method !== 'POST') return response({ payments: recordedPayments });
      const saved = recordedPayments.find(payment => payment.id === input.id);
      if (saved) return response({ payment: saved });
      const payment = { ...input, amount: Number(input.amount), date: '2026-11-04T21:00:00.000Z', status: 'Complete' };
      recordedPayments = [payment, ...recordedPayments];
      return response({ payment });
    }
    if (url.endsWith('/import')) {
      for (const partner of input.partners) if (!persisted.some(item => item.id === partner.id)) persisted.push({ ...partner, revision: 1 });
      return response({ imported: true });
    }
    if (options.method === 'POST' || options.method === 'PATCH') {
      const partner = { ...input, revision: (input.revision || 0) + 1 };
      persisted = [...persisted.filter(item => item.id !== partner.id), partner];
      return response({ partner });
    }
    return response({ partners: JSON.parse(JSON.stringify(persisted)) });
  });
});
afterEach(() => { delete global.fetch; });
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Add partner' })).toBeEnabled());

test('all-partners overview drills into a partner and scopes both bets and payments', async () => {
  const user = userEvent.setup();
  render(<PartnersPage partners={partners} bets={bets} payments={payments} />);
  expect(within(screen.getByRole('group', { name: 'Partners' })).getAllByRole('button').map(button => button.textContent)).toEqual(['All Partners', 'Partner A', 'Partner B']);
  const balances = screen.getByRole('table', { name: 'Partner balances' });
  await user.click(within(balances).getByRole('button', { name: 'Partner A' }));
  const reports = screen.getByRole('table', { name: 'Bet reports' });
  expect(within(reports).getByText('Hockey game / Over 5.5')).toBeInTheDocument();
  expect(within(reports).queryByText('Race winner / Driver B')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Payments', exact: true }));
  expect(screen.getByText('A transfer')).toBeInTheDocument();
  expect(screen.queryByText('B transfer')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All Partners', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Bet reports', exact: true }));
  expect(screen.getByText('Race winner / Driver B')).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'Hockey');
  expect(screen.queryByText('Race winner / Driver B')).not.toBeInTheDocument();
});

test('creates a partner tab, prevents duplicate names, and restores tabs on remount', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<PartnersPage />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), '  Sam  ');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('button', { name: 'Sam', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Sam · Bet reports' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), 'sam');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('alert')).toHaveTextContent('already has a tab');
  unmount();
  window.localStorage.clear();
  render(<PartnersPage />);
  await ready();
  expect(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Sam', exact: true })).toBeInTheDocument();
});

test('imports browser partners before removing the backup and preserves their IDs', async () => {
  window.localStorage.setItem('betting-hub.partner-names.v1', JSON.stringify([{ id: 'local-original', name: 'Trevor', telegramChannel: '@trevor_partner' }]));
  render(<PartnersPage />); await ready();
  expect(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Trevor', exact: true })).toBeInTheDocument();
  expect(persisted[0]).toMatchObject({ id: 'local-original', name: 'Trevor', telegramChannel: '@trevor_partner' });
  expect(window.localStorage.getItem('betting-hub.partner-names.v1')).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/partners/import', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Betting-Hub': 'partners' }) }));
});

test('failed imports keep the browser backup for recovery', async () => {
  const backup = JSON.stringify([{ id: 'local-original', name: 'Trevor' }]);
  window.localStorage.setItem('betting-hub.partner-names.v1', backup);
  fetch.mockRejectedValueOnce(new Error('Partner database unavailable.'));
  render(<PartnersPage />); await ready();
  expect(screen.getByRole('alert')).toHaveTextContent('Partner database unavailable');
  expect(window.localStorage.getItem('betting-hub.partner-names.v1')).toBe(backup);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh partners' }));
  await within(screen.getByRole('group', { name: 'Partners' })).findByRole('button', { name: 'Trevor', exact: true });
});

test('database partners still load when browser storage is blocked', async () => {
  persisted = [{ id: 'saved', name: 'Saved partner', revision: 1 }];
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Disabled'); });
  try { render(<PartnersPage />); await ready(); expect(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Saved partner', exact: true })).toBeInTheDocument(); }
  finally { spy.mockRestore(); }
});

test('does not turn missing partner balances into zero amounts', async () => {
  render(<PartnersPage partners={[{ id: 'a', name: 'Unconnected partner' }]} />);
  await ready();
  const balances = screen.getByRole('table', { name: 'Partner balances' });
  expect(within(balances).queryByText('$0.00')).not.toBeInTheDocument();
  expect(within(balances).getAllByText('—')).toHaveLength(6);
});

test('handles invalid saved data and reports database failures without claiming to save', async () => {
  window.localStorage.setItem('betting-hub.partner-names.v1', 'invalid-json');
  render(<PartnersPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Add partner' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Partner name' }), { target: { value: 'Sam' } });
  fetch.mockRejectedValueOnce(new Error('Unable to save partner.'));
  fireEvent.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
  expect(screen.queryByRole('button', { name: 'Sam', exact: true })).not.toBeInTheDocument();
});

test('creates a partner with a Telegram channel and persists channel edits and removal', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<PartnersPage />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), 'Sam');
  await user.type(screen.getByRole('textbox', { name: 'Telegram group (optional)' }), 'https://t.me/sam_bets');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByText('@sam_bets')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit channel' }));
  await user.clear(screen.getByRole('textbox', { name: 'Telegram channel', exact: true }));
  await user.type(screen.getByRole('textbox', { name: 'Telegram channel', exact: true }), '-1001234567890');
  await user.click(screen.getByRole('button', { name: 'Save channel' }));
  expect(screen.getByText('-1001234567890')).toBeInTheDocument();
  unmount();
  render(<PartnersPage />);
  await ready();
  await user.click(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Sam' }));
  expect(screen.getByText('-1001234567890')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit channel' }));
  await user.clear(screen.getByRole('textbox', { name: 'Telegram channel', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Save channel' }));
  expect(screen.getByText('No channel added')).toBeInTheDocument();
  expect(persisted[0].telegramChannel).toBe('');
  expect(window.localStorage.getItem('betting-hub.partner-names.v1')).toBeNull();
});

test('adds a channel to an existing partner without changing balances or another partner', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('betting-hub.partner-names.v1', JSON.stringify([{ id: 'a', name: 'Partner A' }]));
  render(<PartnersPage partners={partners} />);
  await ready();
  await user.click(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Partner A' }));
  await user.click(screen.getByRole('button', { name: 'Add Telegram channel' }));
  await user.type(screen.getByRole('textbox', { name: 'Telegram channel', exact: true }), '@partner_a');
  await user.click(screen.getByRole('button', { name: 'Save channel' }));
  expect(screen.getByText('@partner_a')).toBeInTheDocument();
  expect(screen.getByText('$25.00')).toBeInTheDocument();
  await user.click(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name: 'Partner B' }));
  expect(screen.getByText('No channel added')).toBeInTheDocument();
  expect(screen.queryByText('@partner_a')).not.toBeInTheDocument();
});

test('rejects an invalid channel before saving the partner', async () => {
  const user = userEvent.setup();
  render(<PartnersPage />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Add partner' }));
  await user.type(screen.getByRole('textbox', { name: 'Partner name' }), 'Sam');
  await user.type(screen.getByRole('textbox', { name: 'Telegram group (optional)' }), 'https://example.com/channel');
  await user.click(screen.getByRole('button', { name: 'Create tab' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Use an @channel username');
  expect(window.localStorage.getItem('betting-hub.partner-names.v1')).toBeNull();
});


test('shows Telegram fills under the correct partner and reloads saved grades and P/L', async () => {
  persisted = [{ id: 'a', name: 'Partner A', legacyIds: ['old-a'] }, { id: 'b', name: 'Partner B' }];
  const fill = { id: 'fill-1', betId: 'BOS145', partnerId: 'old-a', betDate: '2026-11-04', event: 'Boston vs Toronto', team: 'Boston', selection: 'Moneyline', sport: 'hockey', stake: 200, odds: 150, status: 'UNGRADED', settledProfit: null };
  reportedBets = [fill, { ...fill, id: 'fill-2', partnerId: 'b', betId: 'TOR145' }];
  render(<PartnersPage />);
  const tabs = screen.getByRole('group', { name: 'Partners' });
  fireEvent.click(await within(tabs).findByRole('button', { name: 'Partner A' }));
  const table = screen.getByRole('table', { name: 'Bet reports' });
  const pending = (await within(table).findByText('BOS145')).closest('tr');
  expect(pending).toHaveTextContent('Boston vs Toronto / Boston / Moneyline');
  expect(pending).toHaveTextContent('$200.00');
  expect(pending).toHaveTextContent('+150');
  expect(pending).toHaveTextContent('Pending');
  expect(within(table).queryByText('TOR145')).not.toBeInTheDocument();
  reportedBets = [{ ...fill, status: 'WIN', settledProfit: 300 }, reportedBets[1]];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh partners' }));
  expect(await within(table).findByText('WIN')).toBeInTheDocument();
  expect(within(table).getByText('WIN')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Balances', exact: true }));
  const balances = screen.getByRole('table', { name: 'Partner balances' });
  expect(within(balances).getAllByText('$300.00')).toHaveLength(3);
});

test('payments clear each partner’s settled balance in either direction and survive a remount', async () => {
  const user = userEvent.setup();
  let sequence = 0;
  window.crypto.randomUUID = () => `payment-${++sequence}`;
  persisted = [{ id: 'a', name: 'Partner A', legacyIds: ['old-a'] }, { id: 'b', name: 'Partner B' }];
  reportedBets = [
    { id: '1', betId: 'BOS145', partnerId: 'old-a', stake: 100, status: 'LOSS', settledProfit: -100 },
    { id: '2', betId: 'TOR145', partnerId: 'b', stake: 100, status: 'WIN', settledProfit: 100 },
    { id: '3', betId: 'BOS146', partnerId: 'a', stake: 400, status: 'UNGRADED', settledProfit: null },
  ];
  const { unmount } = render(<PartnersPage />);
  const stat = label => screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card').querySelector('.stat-value');
  const choose = name => user.click(within(screen.getByRole('group', { name: 'Partners' })).getByRole('button', { name, exact: true }));
  const add = async (direction, amount, reference, partnerId) => {
    const button = await screen.findByRole('button', { name: 'Add payment' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    if (partnerId) await user.selectOptions(screen.getByLabelText('Partner', { exact: true }), partnerId);
    await user.selectOptions(screen.getByLabelText('Direction'), direction);
    await user.type(screen.getByLabelText('Amount (USD)'), amount);
    await user.type(screen.getByLabelText('Reference (optional)'), reference);
    await user.click(screen.getByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText(reference)).toBeInTheDocument();
  };
  await ready();
  await waitFor(() => expect(stat('Owed to partner')).toHaveTextContent('$100.00'));
  expect(stat('Owed to you')).toHaveTextContent('$100.00');
  await choose('Partner A');
  expect(stat('Owed to you')).toHaveTextContent('$0.00');
  await add('Sent', '60.25', 'First transfer');
  expect(stat('Owed to partner')).toHaveTextContent('$39.75');
  await add('Sent', '39.75', 'Final transfer');
  expect(stat('Owed to partner')).toHaveTextContent('$0.00');
  expect(stat('Open exposure')).toHaveTextContent('$400.00');
  await choose('All Partners');
  expect(stat('Owed to you')).toHaveTextContent('$100.00');
  await add('Received', '100', 'Partner B transfer', 'b');
  expect(stat('Owed to you')).toHaveTextContent('$0.00');
  unmount();

  render(<PartnersPage />);
  await ready();
  await choose('Partner B');
  await user.click(screen.getByRole('button', { name: 'Payments', exact: true }));
  expect(await screen.findByText('Partner B transfer')).toBeInTheDocument();
  expect(screen.queryByText('Final transfer')).not.toBeInTheDocument();
  expect(stat('Owed to you')).toHaveTextContent('$0.00');
});

test('edits partner and bet splits independently and exports the selected partner’s exact shares', async () => {
  persisted = [{ id: 'a', name: 'Partner A', telegramChannel: '@sam', splitPercent: 50, revision: 1 },
    { id: 'b', name: 'Partner B', splitPercent: 100, revision: 1 }];
  reportedBets = [
    { id: 'first', betId: 'BOS145', partnerId: 'a', stake: 1000, status: 'WIN', settledProfit: 1000, splitPercent: 50, revision: 1 },
    { id: 'open', betId: 'BOS146', partnerId: 'a', stake: 1000, status: 'UNGRADED', settledProfit: null, splitPercent: 50, revision: 1 },
    { id: 'other', betId: 'TOR145', partnerId: 'b', stake: 1000, status: 'WIN', settledProfit: 1000, splitPercent: 100, revision: 1 },
  ];
  recordedPayments = [{ id: 'payment', partnerId: 'a', amount: 200, direction: 'Received', status: 'Complete' }];
  render(<PartnersPage />);
  const tabs = screen.getByRole('group', { name: 'Partners' });
  fireEvent.click(await within(tabs).findByRole('button', { name: 'Partner A' }));
  const table = screen.getByRole('table', { name: 'Bet reports' });
  await within(table).findByText('BOS145');
  const stat = label => screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card').querySelector('.stat-value');
  expect(stat('Open exposure')).toHaveTextContent('$500.00');
  expect(stat('Owed to you')).toHaveTextContent('$300.00');

  fireEvent.click(screen.getByRole('button', { name: 'Edit partner split' }));
  fireEvent.change(screen.getByLabelText('Split (%)'), { target: { value: '25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save partner split' }));
  await waitFor(() => expect(persisted.find(partner => partner.id === 'a')).toMatchObject({ splitPercent: 25, telegramChannel: '@sam' }));
  expect(stat('Open exposure')).toHaveTextContent('$500.00');
  expect(stat('Owed to you')).toHaveTextContent('$300.00');

  const editBet = within(table).getByRole('button', { name: 'Edit split for BOS145' });
  await waitFor(() => expect(editBet).toBeEnabled());
  fireEvent.click(editBet);
  fireEvent.change(within(table).getByLabelText('Split for BOS145'), { target: { value: '25' } });
  fireEvent.click(within(table).getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(stat('Owed to you')).toHaveTextContent('$50.00'));
  expect(stat('Open exposure')).toHaveTextContent('$500.00');

  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:partner-history');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Download bet history (2)' }));
    const csv = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(URL.createObjectURL.mock.calls[0][0]);
    });
    expect(click.mock.instances[0].download).toBe('partner-a-bet-history.csv');
    expect(csv).toContain('"Split (%)","Your risk","Your P/L"');
    expect(csv).toContain('"WIN",1000,25,250,250');
    expect(csv).not.toContain('TOR145');
  } finally {
    click.mockRestore();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
