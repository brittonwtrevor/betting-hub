import React, { useRef, useState } from 'react';

export default function PartnerPaymentForm({ partner, partners, saving, onSave, onCancel }) {
  const [partnerId, setPartnerId] = useState(partner?.id || '');
  const [direction, setDirection] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const id = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    try {
      id.current ??= window.crypto.randomUUID();
      await onSave({ id: id.current, partnerId, direction, amount, reference });
    } catch (failure) { setError(failure.message); }
  }

  return <form id="add-partner-payment" className="partner-form partner-payment-form" onSubmit={submit}>
    <fieldset disabled={saving}>
      <legend>Record a payment{partner ? ` for ${partner.name}` : ''}</legend>
      <div className="partner-payment-fields">
        {!partner && <label>Partner
          <select autoFocus required value={partnerId} onChange={event => setPartnerId(event.target.value)}>
            <option value="">Choose a partner</option>
            {partners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <label>Direction
          <select autoFocus={Boolean(partner)} required value={direction} onChange={event => setDirection(event.target.value)}>
            <option value="">Choose a direction</option>
            <option value="Sent">I paid the partner</option>
            <option value="Received">The partner paid me</option>
          </select>
        </label>
        <label>Amount (USD)
          <input type="number" inputMode="decimal" required min="0.01" max="10000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
        </label>
        <label>Reference (optional)
          <input maxLength={200} value={reference} onChange={event => setReference(event.target.value)} />
        </label>
      </div>
      <div className="partner-payment-actions">
        <button type="submit" className="button button-primary">{saving ? 'Saving…' : 'Save payment'}</button>
        <button type="button" className="button button-secondary" onClick={onCancel}>Cancel payment</button>
      </div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}
