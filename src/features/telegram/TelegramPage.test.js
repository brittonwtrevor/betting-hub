import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TelegramPage from './TelegramPage';

const saved = { configured: true, bot: { username: 'test_bot', name: 'Test' }, defaultChatId: '-1001234567890' };
const response = value => ({ ok: true, json: async () => value });
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

test('loads only masked configuration and saves token to the protected backend, then clears the input', async () => {
  fetch.mockResolvedValueOnce(response({ configured: false, defaultChatId: '', bot: null })).mockResolvedValueOnce(response(saved));
  render(<TelegramPage />);
  await waitFor(() => expect(screen.queryByText('Loading Telegram connection…')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: '123456789:fake-token-for-test-only' } });
  fireEvent.change(screen.getByLabelText('Default chat ID (optional)'), { target: { value: '-1001234567890' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));
  await screen.findByText('Credentials saved. Connected to @test_bot.');
  expect(screen.getByLabelText('Bot token')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Bot token')).toHaveValue('');
  expect(fetch.mock.calls[1][0]).toBe('/api/telegram/config');
  expect(fetch.mock.calls[1][1].method).toBe('PUT');
  expect(fetch.mock.calls[1][1].headers['X-Betting-Hub']).toBe('telegram');
  expect(window.localStorage.getItem('telegram-token')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('reading is manual and sends only after submitting the composer', async () => {
  fetch.mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({ messages: [{ updateId: 1, kind: 'message', chat: 'Test group', chatId: '-1001234567890', from: 'trevor', text: 'hello', date: '2026-11-04T15:00:00Z' }], fetchedAt: '2026-11-04T15:00:00Z' }))
    .mockResolvedValueOnce(response({ message: { chat: 'Test group', chatId: '-1001234567890', date: '2026-11-04T15:00:00Z' } }));
  render(<TelegramPage />);
  await screen.findByText('@test_bot');
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Read pending messages' }));
  await screen.findByText('hello');
  fireEvent.click(screen.getByRole('button', { name: 'Use this chat' }));
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a reply' } });
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText(/Message sent to Test group/);
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ chatId: '-1001234567890', text: 'a reply' });
  expect(screen.getByLabelText('Message')).toHaveValue('');
});

test('retains an unsent message and reports delivery failure without retrying', async () => {
  fetch.mockResolvedValueOnce(response(saved)).mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Check the chat before retrying.' }) });
  render(<TelegramPage />);
  await screen.findByText('@test_bot');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'keep this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the chat before retrying.');
  expect(screen.getByLabelText('Message')).toHaveValue('keep this');
  expect(fetch).toHaveBeenCalledTimes(2);
});
