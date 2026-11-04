import { normalizeTelegramChannel } from './telegram';

test.each([
  [' ', ''], [' @partner_bets ', '@partner_bets'], ['-1001234567890', '-1001234567890'],
  ['t.me/partner_bets', '@partner_bets'], ['https://t.me/partner_bets/', '@partner_bets'],
  ['https://t.me/+Invite_Token-123', 'https://t.me/+Invite_Token-123'],
  ['http://t.me/joinchat/Invite_Token-123', 'https://t.me/joinchat/Invite_Token-123'],
])('normalizes channel reference %s', (input, expected) => {
  expect(normalizeTelegramChannel(input)).toBe(expected);
});

test.each([
  'javascript:alert(1)', 'https://t.me.evil.example/channel', 'https://t.me@evil.example/channel',
  'https://user@t.me/channel', 'https://t.me/channel/123', 'https://t.me/channel?start=token',
  'https://t.me/', 'not a channel',
])('rejects unsupported channel reference %s', input => {
  expect(() => normalizeTelegramChannel(input)).toThrow();
});
