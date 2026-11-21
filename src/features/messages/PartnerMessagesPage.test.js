import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnerMessagesPage from './PartnerMessagesPage';

const id = '9709b3c0-bddd-4ad0-8e9b-2c6c53f98a11';
const partners = [
  { id: 'a', name: 'Partner A', telegramChannel: '@SharedChat' },
  { id: 'b', name: 'Partner B', telegramChannel: '@sharedchat' },
  { id: 'c', name: 'Partner C', telegramChannel: '-100123' },
  { id: 'd', name: 'Partner D', telegramChannel: '' },
  { id: 'e', name: 'Partner E', telegramChannel: 'https://t.me/+invite' },
];
const receipt = text => ({ id, text, createdAt: '2026-11-21T19:00:00Z', deliveries: [
  { channel: '@sharedchat', partners: ['Partner A', 'Partner B'], status: 'pending', error: '' },
  { channel: '-100123', partners: ['Partner C'], status: 'pending', error: '' },
] });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
let messages;
let originalCrypto;
beforeEach(() => {
  window.localStorage.clear();
  originalCrypto = Object.getOwnPropertyDescriptor(window, 'crypto');
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => id } });
  messages = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/partners') return response({ partners });
    if (url === '/api/partner-messages' && options.method === 'POST') {
      const input = JSON.parse(options.body);
      messages = [receipt(input.text)];
      return response({ message: messages[0] }, 201);
    }
    if (url === `/api/partner-messages/${id}`) return messages[0] ? response({ message: messages[0] }) : response({ message: 'Not found' }, 404);
    if (url.endsWith('/retry')) {
      messages = messages.map(message => ({ ...message, deliveries: message.deliveries.map(delivery => delivery.status === 'failed' ? { ...delivery, status: 'pending', error: '' } : delivery) }));
      return response({ message: messages[0] });
    }
    return response({ messages });
  });
});
afterEach(() => {
  delete global.fetch;
  if (originalCrypto) Object.defineProperty(window, 'crypto', originalCrypto);
  else delete window.crypto;
});

test('selects eligible partners individually or together and queues the exact plain message', async () => {
  const user = userEvent.setup();
  render(<PartnerMessagesPage />);
  await screen.findByText('No messages sent yet.');
  const group = within(await screen.findByRole('group', { name: 'Message recipients' }));
  expect(group.getByRole('checkbox', { name: /Partner D/ })).toBeDisabled();
  expect(group.getByRole('checkbox', { name: /Partner E/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send to 0 partners' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Select all' }));
  expect(screen.getByText('3 partners · 2 Telegram channels')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send to 3 partners' })).toBeDisabled();
  await user.click(group.getByRole('checkbox', { name: /Partner B/ }));
  expect(screen.getByRole('button', { name: 'Send to 2 partners' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear', exact: true }));
  expect(group.getByRole('checkbox', { name: /Partner A/ })).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Select all' }));
  const text = 'Hello partners!\nUpdates +110 & <plain text> 🎯';
  fireEvent.change(screen.getByLabelText('Telegram message'), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: 'Send to 3 partners' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Message queued.');
  expect(screen.getByLabelText('Telegram message')).toHaveValue('');
  expect(screen.getByText('0 / 2 sent')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Channel delivery status' })).toHaveTextContent('Partner A, Partner B');
  const [, options] = fetch.mock.calls.find(([url, opts]) => url === '/api/partner-messages' && opts.method === 'POST');
  expect(JSON.parse(options.body)).toEqual({ id, text, partnerIds: ['a', 'b', 'c'] });
  expect(options.headers['X-Betting-Hub']).toBe('partner-messages');
  expect(fetch.mock.calls.every(([url]) => !url.includes('telegram.org'))).toBe(true);
});

test('shows channel outcomes and retries only the existing message’s failed deliveries', async () => {
  messages = [{ ...receipt('Updates'), deliveries: [
    { channel: '@sharedchat', partners: ['Partner A'], status: 'sent', error: '' },
    { channel: '-100123', partners: ['Partner C'], status: 'failed', error: 'No posting permission' },
    { channel: '-100456', partners: ['Partner B'], status: 'uncertain', error: 'Check this chat before sending again.' },
  ] }];
  const user = userEvent.setup();
  render(<PartnerMessagesPage />);
  const list = within(await screen.findByRole('list', { name: 'Channel delivery status' }));
  expect(list.getByText('Sent', { exact: true })).toBeInTheDocument();
  expect(list.getByText('Failed', { exact: true })).toBeInTheDocument();
  expect(list.getByText('Check Telegram', { exact: true })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry 1 failed channel' }));
  await screen.findByText('Failed channels queued for another attempt.');
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/retry'))).toHaveLength(1);
  expect(fetch.mock.calls.some(([url, options]) => url === '/api/partner-messages' && options.method === 'POST')).toBe(false);
  expect(list.getByText('Check Telegram', { exact: true })).toBeInTheDocument();
  expect(list.getByText('Queued', { exact: true })).toBeInTheDocument();
});

test('a lost queue response keeps the draft locked until its original receipt is checked', async () => {
  const original = fetch.getMockImplementation();
  fetch.mockImplementation(async (url, options) => {
    const result = await original(url, options);
    if (url === '/api/partner-messages' && options?.method === 'POST') throw new TypeError('Network interrupted');
    return result;
  });
  const user = userEvent.setup();
  render(<PartnerMessagesPage />);
  await screen.findByText('No messages sent yet.');
  await user.click(await screen.findByRole('checkbox', { name: /Partner A/ }));
  fireEvent.change(screen.getByLabelText('Telegram message'), { target: { value: 'Check this send' } });
  await user.click(screen.getByRole('button', { name: 'Send to 1 partner' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Telegram message')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Check delivery status' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Message queued.');
  expect(fetch.mock.calls.filter(([url, options]) => url === '/api/partner-messages' && options.method === 'POST')).toHaveLength(1);
});

test('a missing receipt retries queueing with the same ID and unchanged message', async () => {
  const original = fetch.getMockImplementation();
  let attempts = 0;
  fetch.mockImplementation(async (url, options) => {
    if (url === '/api/partner-messages' && options?.method === 'POST' && ++attempts === 1) throw new TypeError('Network interrupted');
    return original(url, options);
  });
  const user = userEvent.setup();
  render(<PartnerMessagesPage />);
  await screen.findByText('No messages sent yet.');
  await user.click(await screen.findByRole('checkbox', { name: /Partner A/ }));
  fireEvent.change(screen.getByLabelText('Telegram message'), { target: { value: 'Keep this message' } });
  await user.click(screen.getByRole('button', { name: 'Send to 1 partner' }));
  await user.click(await screen.findByRole('button', { name: 'Check delivery status' }));
  await user.click(await screen.findByRole('button', { name: 'Retry queueing' }));
  await screen.findByRole('status');
  const attemptsSent = fetch.mock.calls.filter(([url, options]) => url === '/api/partner-messages' && options.method === 'POST');
  expect(attemptsSent).toHaveLength(2);
  expect(attemptsSent[0][1].body).toBe(attemptsSent[1][1].body);
});
