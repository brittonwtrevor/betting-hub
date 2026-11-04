const { createHash } = require('node:crypto');
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const dollars = value => value == null ? 'Not provided' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
function notificationText(kind, bet) {
  const lines = [kind === 'logged' ? 'BET LOGGED' : bet.grade === 'UNGRADED' ? 'BET GRADE CLEARED' : 'BET GRADED',
    `Bet ID: ${bet.betId}`, `Game: ${bet.game || 'Needs review'}`, `Team: ${bet.team || 'Needs review'}`,
    `Bet: ${bet.bet || 'Needs review'}`, `Risk: ${dollars(bet.risk)}`, `Odds: ${bet.odds == null ? 'Not provided' : bet.odds > 0 ? `+${bet.odds}` : bet.odds}`,
    `Partner: ${bet.partnerName || 'Unknown'}`, `Bettor: ${bet.bettorName || 'Needs review'}`, `Bet date (ET): ${bet.betDate || 'Needs review'}`];
  if (kind === 'grade') lines.push(`Grade: ${bet.grade}`, `Net P/L: ${bet.pl == null ? 'Ungraded' : `${bet.pl > 0 ? '+' : ''}${dollars(bet.pl)}`}`);
  else if (!bet.complete) lines.push('Some details need review in Confirms.');
  return lines.join('\n');
}

function createConfirmNotifications({ telegramService, now = () => new Date(), logger = console } = {}) {
  return {
    async ensure(pool) {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_confirm_notifications (
        id CHAR(64) NOT NULL PRIMARY KEY, bet_row_id VARCHAR(36) NOT NULL, bet_revision INT NOT NULL,
        source_id CHAR(64) NOT NULL, bot_id BIGINT NOT NULL, chat_id BIGINT NOT NULL, kind VARCHAR(16) NOT NULL,
        payload JSON NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
        retry_at_ms BIGINT NOT NULL DEFAULT 0, telegram_message_id BIGINT NULL, last_error TEXT NULL,
        created_at VARCHAR(24) NOT NULL, updated_at VARCHAR(24) NOT NULL,
        INDEX pending_notifications (status, retry_at_ms), INDEX bet_notifications (source_id, bet_row_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    },
    async enqueue(db, sourceId, betId, revision, kind, bet) {
      const id = createHash('sha256').update(`${betId}:${revision}:${kind}`).digest('hex');
      const at = now().toISOString();
      await db.execute(`INSERT INTO hub_confirm_notifications
        (id, bet_row_id, bet_revision, source_id, bot_id, chat_id, kind, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [id, betId, revision, sourceId, bet.telegramBotId, bet.telegramChatId, kind, JSON.stringify({ text: notificationText(kind, bet) }), at, at]);
    },
    async flush(pool) {
      if (!telegramService) return;
      let db, locked = false, reusable = true;
      try {
        db = await pool.getConnection();
        const [[lock]] = await db.execute("SELECT GET_LOCK('betting-hub:confirm-notifications', 0) AS acquired");
        if (Number(lock.acquired) !== 1) return;
        locked = true;
        // A crashed request may already have reached Telegram. Never resend it
        // automatically: sendMessage has no delivery idempotency key.
        await db.execute("UPDATE hub_confirm_notifications SET status = 'uncertain', last_error = ?, updated_at = ? WHERE status = 'sending'",
          ['Delivery was interrupted. Check the partner chat before sending another message.', now().toISOString()]);
        const [jobs] = await db.execute(`SELECT n.*, b.payload AS bet_payload FROM hub_confirm_notifications n
          JOIN hub_confirm_bets b ON b.id = n.bet_row_id
          WHERE n.status = 'pending' OR (n.status = 'error' AND n.attempts < 3 AND n.retry_at_ms <= ?)
          ORDER BY n.created_at, n.bet_revision, n.id LIMIT 10`, [now().getTime()]);
        for (const job of jobs) {
          if (decode(job.bet_payload).deletedAt) {
            await db.execute("UPDATE hub_confirm_notifications SET status = 'cancelled', updated_at = ? WHERE id = ?", [now().toISOString(), job.id]);
            continue;
          }
          // Pause later messages for this bet while an earlier receipt awaits a
          // definitive delivery. This keeps LOGGED before GRADED after failures.
          const [[earlier]] = await db.execute(`SELECT COUNT(*) AS n FROM hub_confirm_notifications
            WHERE bet_row_id = ? AND bet_revision < ? AND (status IN ('pending', 'sending') OR (status = 'error' AND attempts < 3))`, [job.bet_row_id, job.bet_revision]);
          if (Number(earlier.n)) continue;
          await db.execute("UPDATE hub_confirm_notifications SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?", [now().toISOString(), job.id]);
          try {
            const result = await telegramService.sendMessage({ chatId: String(job.chat_id), expectedBotId: String(job.bot_id), text: decode(job.payload).text });
            await db.execute("UPDATE hub_confirm_notifications SET status = 'sent', telegram_message_id = ?, last_error = NULL, updated_at = ? WHERE id = ?",
              [result.message.messageId, now().toISOString(), job.id]);
          } catch (error) {
            const uncertain = error.deliveryUncertain || !error.telegramSafe;
            await db.execute('UPDATE hub_confirm_notifications SET status = ?, last_error = ?, retry_at_ms = ?, updated_at = ? WHERE id = ?',
              [uncertain ? 'uncertain' : 'error', uncertain ? 'Delivery unconfirmed. Check the partner chat before sending another message.' : error.message,
                now().getTime() + 60000, now().toISOString(), job.id]);
          }
        }
      } catch { logger.error('Telegram confirmation delivery is unavailable. Saved bets and queued receipts are preserved.'); }
      finally {
        if (db) {
          if (locked) {
            try { await db.execute("SELECT RELEASE_LOCK('betting-hub:confirm-notifications')"); }
            catch { reusable = false; db.destroy(); }
          }
          if (reusable) db.release();
        }
      }
    },
  };
}
module.exports = { createConfirmNotifications, notificationText };
