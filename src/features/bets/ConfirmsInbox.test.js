import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import ConfirmsInbox from './ConfirmsInbox';
import { normalizeFields } from './confirmationFields';
import { easternBetDay } from './BetFilters';

const today = easternBetDay(new Date());
const relativeDay = days => new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
const reply = { botId: '1', updateId: 42, messageId: 10, kind: 'message', chat: 'trevor_partner', from: 'TrevorBRedSox', chatId: '-5550868176', text: 'HAN187 $1 -110 ML', betIds: ['HAN187'], date: `${today}T18:17:00.000Z` };
const id = 'a'.repeat(64);
const base = { id: 'bet-1', sourceId: id, revision: 1, partnerId: 'trevor', partnerName: 'Trevor', bettorName: 'Trevor Britton',
  betDate: today, betAt: reply.date, rawResponse: reply.text, gameAt: '2026-11-05T00:00:00.000Z', telegramSenderId: '123', telegramSenderUsername: 'TrevorBRedSox',
  ...normalizeFields({ betId: 'HAN187', game: 'Hanwha Life Esports vs Bilibili Gaming', team: 'Hanwha Life Esports', bet: 'Moneyline', risk: 1, odds: -110, grade: 'UNGRADED' }) };
const response = (value, ok = true) => ({ ok, json: async () => value });
let stored;
beforeEach(() => {
  window.history.replaceState(null, '', '/'); window.scrollTo = jest.fn();
  stored = { sources: [{ id, revision: 2, status: 'parsed', message: reply, partner: { name: 'Trevor' }, issues: [], bets: [{ ...base }] }],
    receiver: { enabled: true, lastPolledAt: new Date().toISOString() }, parser: { configured: true, enabled: true } };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/partners') return response({ partners: [] });
    if (url === '/api/send-drafts') return response({ drafts: [] });
    if (options.method === 'PATCH') {
      const input = JSON.parse(options.body);
      const bet = { ...input, revision: input.revision + 1, ...normalizeFields(input) };
      const source = stored.sources.find(item => item.id === bet.sourceId);
      source.bets = source.bets.map(item => item.id === bet.id ? bet : item);
      return response({ bet });
    }
    if (options.method === 'DELETE') {
      stored.sources[0].bets = []; stored.sources[0].deletedBetCount = 1;
      return response({ bet: { id: base.id, deletedAt: new Date().toISOString(), notification: { id: 'delete-receipt', kind: 'delete', status: 'pending' } } });
    }
    if (url.endsWith('/manual')) {
      const { betId = base.betId } = JSON.parse(options.body);
      const bet = { ...base, betId, id: 'bet-2', risk: null, odds: null, complete: false };
      stored.sources[0].bets.push(bet); stored.sources[0].revision++; return response({ bet });
    }
    return response(JSON.parse(JSON.stringify(stored)));
  });
});

test('shows partner and read-only bet details, hides bettor, and preserves metadata when saving', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  expect(screen.getByLabelText('Bet ID for bet-1')).toHaveTextContent('HAN187');
  expect(screen.getByLabelText('Bet date (ET) for bet-1')).toHaveTextContent(today);
  expect(screen.getByLabelText('Game for bet-1')).toHaveTextContent(base.game);
  expect(screen.getByLabelText('Raw response for bet-1')).toHaveTextContent(reply.text);
  expect(screen.queryByRole('textbox', { name: 'Raw response for bet-1' })).not.toBeInTheDocument();
  for (const label of ['Bet ID', 'Bet date (ET)', 'Game']) expect(screen.getByLabelText(`${label} for bet-1`)).not.toHaveAttribute('contenteditable');
  expect(screen.queryByRole('textbox', { name: /Bet ID|Bet date|Game/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'BETTOR' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Bettor for bet-1')).not.toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Trevor' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Risk for bet-1'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(stored.sources[0].bets[0]).toMatchObject({ id: base.id, betId: base.betId, game: base.game, bettorName: base.bettorName, betDate: base.betDate, partnerId: 'trevor', risk: 250 }));
});

test('deletion can be cancelled, removes only the selected bet, and polling does not restore it', async () => {
  jest.useFakeTimers();
  await act(async () => { render(<ConfirmsInbox />); });
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  expect(screen.getByText(/Delete HAN187/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
  expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await act(async () => {});
  expect(screen.queryByLabelText('Bet ID for bet-1')).not.toBeInTheDocument();
  expect(screen.getByText(/1 deleted bet/)).toBeInTheDocument();
  expect(screen.getByText('Telegram deletion for HAN187: Queued')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry AI' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/confirms/bets/bet-1', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ revision: 1 }) }));
  // An older in-flight refresh must not resurrect a row just deleted locally.
  stored.sources[0].bets = [{ ...base }];
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(screen.queryByLabelText('Bet ID for bet-1')).not.toBeInTheDocument();
});

test('a failed delete keeps the saved bet visible with an error', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  fireEvent.click(screen.getByRole('button', { name: 'Delete bet' }));
  fetch.mockResolvedValueOnce(response({ message: 'This bet changed on another screen.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed on another screen');
  expect(screen.getByLabelText('Bet ID for bet-1')).toBeInTheDocument();
});
afterEach(() => { delete global.fetch; jest.useRealTimers(); });

test('shows queued and failed Telegram receipts and refreshes their delivery status', async () => {
  stored.sources[0].bets[0].notifications = [{ id: 'receipt-1', kind: 'logged', status: 'pending' },
    { id: 'receipt-2', kind: 'grade', status: 'error', error: 'Bot cannot access that chat.' }];
  render(<ConfirmsInbox />);
  expect(await screen.findByText('Telegram log: Queued')).toBeInTheDocument();
  expect(screen.getByText(/Telegram grade: Delivery failed/)).toHaveTextContent('Bot cannot access that chat.');
  stored.sources[0].bets[0].notifications[0].status = 'sent';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh replies' }));
  expect(await screen.findByText('Telegram log: Sent')).toBeInTheDocument();
});

test('loads editable wager fields, grading options and original source without credential controls or all-messages filter', async () => {
  render(<ConfirmsInbox />);
  await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Team', base.team], ['Bet', 'Moneyline'], ['Risk', '1'], ['Odds', '-110']]) expect(screen.getByLabelText(`${label} for bet-1`)).toHaveValue(value);
  const grade = screen.getByRole('combobox', { name: 'Grade for bet-1' });
  expect(within(grade).getAllByRole('option').map(option => option.value)).toEqual(['UNGRADED', 'VOID', 'WIN', 'LOSS', 'PARTRETURN']);
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('—');
  expect(screen.getByLabelText('Raw response for bet-1')).toHaveTextContent(reply.text);
  expect(screen.queryByLabelText('Bot token')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/confirms', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
});

test('groups separate replies by Bet ID and keeps each wager independently editable', async () => {
  const anotherBet = { ...base, id: 'bet-2', bet: 'Map 1', risk: 25, odds: 366, sourceId: 'reply-2' };
  const anotherPartner = { ...base, id: 'bet-3', partnerId: 'kenny', partnerName: 'Kenny', sourceId: 'reply-3' };
  const anotherId = { ...anotherPartner, id: 'bet-4', betId: 'BOS145' };
  stored.sources.push(
    { ...stored.sources[0], id: 'reply-2', message: { ...reply, messageId: 11 }, bets: [anotherBet] },
    { ...stored.sources[0], id: 'reply-3', message: { ...reply, messageId: 12, betIds: ['HAN187', 'BOS145'] }, bets: [anotherPartner, anotherId] },
  );
  render(<ConfirmsInbox />);
  const grouped = within(await screen.findByRole('table', { name: 'Bets for HAN187' }));
  const other = within(screen.getByRole('table', { name: 'Bets for BOS145' }));
  expect(grouped.getAllByRole('row')).toHaveLength(4);
  expect(grouped.getAllByRole('cell', { name: 'Trevor' })).toHaveLength(2);
  expect(grouped.getByRole('cell', { name: 'Kenny' })).toBeInTheDocument();
  expect(other.getAllByRole('row')).toHaveLength(2);
  expect(other.getByLabelText('Risk for bet-4')).toBeInTheDocument();
  expect(grouped.getByLabelText('Odds for bet-2')).toHaveValue('+366');

  fireEvent.change(grouped.getByLabelText('Risk for bet-2'), { target: { value: '75' } });
  fireEvent.click(grouped.getAllByRole('button', { name: 'Save', exact: true }).find(button => !button.disabled));
  await waitFor(() => expect(stored.sources[1].bets[0].risk).toBe(75));
  expect(grouped.getByLabelText('Risk for bet-1')).toHaveValue('1');
  expect(grouped.getByLabelText('Risk for bet-3')).toHaveValue('1');
  expect(other.getByLabelText('Risk for bet-4')).toHaveValue('1');
});

test('defaults to seven Eastern dates, filters individual bets by sport, and expands with the date slider', async () => {
  stored.sources[0].bets[0].sport = 'lol';
  const hockeyReply = (messageId, betDate, date) => ({
    ...stored.sources[0], id: `source-${messageId}`, message: { ...reply, messageId, date },
    bets: [{ ...base, id: `bet-${messageId}`, sport: 'hockey', betDate, betAt: date }],
  });
  const older = hockeyReply(11, '', `${relativeDay(-6)}T01:00:00Z`);
  const recent = hockeyReply(12, relativeDay(-6), `${relativeDay(-8)}T18:00:00Z`);
  stored.sources[0].bets.push({ ...base, id: 'mixed-hockey', sport: 'hockey' });
  stored.sources.push(older, recent);
  render(<ConfirmsInbox />);
  await screen.findByLabelText('Bet ID for bet-1');
  const table = within(screen.getByRole('table', { name: 'Bets for HAN187' }));
  const rowOrder = () => table.getAllByLabelText(/^Bet ID for /).map(item => item.getAttribute('aria-label').replace('Bet ID for ', ''));
  expect(rowOrder()).toEqual(['bet-1', 'mixed-hockey', 'bet-12']);
  fireEvent.change(screen.getByRole('combobox', { name: 'Sport' }), { target: { value: 'hockey' } });
  expect(screen.queryByLabelText('Bet ID for bet-1')).not.toBeInTheDocument();
  expect(table.getByLabelText('Risk for mixed-hockey')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Bet dates (ET) · Last 7 days'));
  const slider = screen.getByRole('slider', { name: 'Adjust start date' });
  fireEvent.change(slider, { target: { value: slider.min } });
  expect(rowOrder()).toEqual(['mixed-hockey', 'bet-12', 'bet-11']);
  fireEvent.click(screen.getByRole('button', { name: 'Reset dates' }));
  expect(rowOrder()).toEqual(['mixed-hockey', 'bet-12']);
  fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
  expect(rowOrder()).toEqual(['mixed-hockey', 'bet-12', 'bet-11']);
});

test('edits wager fields, saves a WIN and persists net P/L', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  for (const [label, value] of [['Team', 'Other team'], ['Bet', 'Spread -1.5'], ['Risk', '500'], ['Odds', '+150']]) fireEvent.change(screen.getByLabelText(`${label} for bet-1`), { target: { value } });
  fireEvent.change(screen.getByLabelText('Grade for bet-1'), { target: { value: 'WIN' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('+$750.00');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled());
  expect(stored.sources[0].bets[0]).toMatchObject({ betId: base.betId, game: base.game, team: 'Other team', bet: 'Spread -1.5', risk: 500, odds: 150, grade: 'WIN', pl: 750 });
  expect(screen.getByLabelText('Odds for bet-1')).toHaveValue('+150');
  const patch = fetch.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(patch[1].headers['X-Betting-Hub']).toBe('confirms');
});

test('PARTRETURN accepts negative or positive net amounts and VOID/LOSS recalculate P/L', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Grade for bet-1');
  const grade = screen.getByLabelText('Grade for bet-1');
  fireEvent.change(grade, { target: { value: 'PARTRETURN' } });
  fireEvent.change(screen.getByLabelText('PARTRETURN net P/L for bet-1'), { target: { value: '-25.50' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('-$25.50');
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(stored.sources[0].bets[0].pl).toBe(-25.5));
  fireEvent.change(grade, { target: { value: 'LOSS' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('-$1.00');
  fireEvent.change(grade, { target: { value: 'VOID' } });
  expect(screen.getByLabelText('P/L for bet-1')).toHaveTextContent('$0.00');
});

test('polling does not overwrite unsaved corrections and failed saves retain edits', async () => {
  jest.useFakeTimers();
  await act(async () => { render(<ConfirmsInbox />); });
  fireEvent.change(screen.getByLabelText('Risk for bet-1'), { target: { value: '250' } });
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('250');
  fetch.mockResolvedValueOnce(response({ message: 'This bet changed on another screen.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('changed on another screen');
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('250');
  fireEvent.click(screen.getByRole('button', { name: 'Reset edits' }));
  expect(screen.getByLabelText('Risk for bet-1')).toHaveValue('1');
});

test('manual entry remains available when AI is not configured', async () => {
  stored.sources[0].bets = []; stored.sources[0].status = 'pending'; stored.parser.configured = false;
  stored.sources[0].eligibleBetIds = ['HAN187', 'BOS145'];
  render(<ConfirmsInbox />); await screen.findByText(/AI parsing needs/);
  const group = within(screen.getByRole('article', { name: 'Bet ID BOS145' }));
  expect(group.getByRole('button', { name: 'Retry AI' })).toBeDisabled();
  fireEvent.click(group.getByRole('button', { name: 'Add bet manually' }));
  await group.findByLabelText('Risk for bet-2');
  expect(screen.getByLabelText('Risk for bet-2')).toHaveValue('');
});

test('refreshes every 10 seconds, searches fields and stops refreshing when unmounted', async () => {
  jest.useFakeTimers(); let mounted;
  await act(async () => { mounted = render(<ConfirmsInbox />); });
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search saved replies' }), { target: { value: 'unrelated' } });
  expect(screen.getByText('No matching replies')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  mounted.unmount();
  await act(async () => { jest.advanceTimersByTime(20000); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('keeps loaded data visible after an inbox refresh failure', async () => {
  render(<ConfirmsInbox />); await screen.findByLabelText('Bet ID for bet-1');
  fetch.mockResolvedValueOnce(response({ message: 'Database temporarily unavailable.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh replies' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Previously loaded replies remain below.');
  expect(screen.getByLabelText('Bet ID for bet-1')).toHaveTextContent('HAN187');
});

test('Confirms deep links and old Telegram bookmarks open the editable bet table without a Telegram tab', async () => {
  window.history.replaceState(null, '', '/#/bets');
  const mounted = render(<App />); await screen.findByText('No Sends drafts yet');
  fireEvent.click(screen.getByRole('tab', { name: 'Confirms' }));
  await screen.findByLabelText('Bet ID for bet-1');
  expect(window.location.hash).toBe('#/bets?tab=confirms');
  mounted.unmount();
  window.history.replaceState(null, '', '/#/telegram');
  render(<App />); await screen.findByLabelText('Bet ID for bet-1');
  expect(document.title).toBe('Active Bets · Betting Hub');
  expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name: 'Telegram', exact: true })).not.toBeInTheDocument();
});
