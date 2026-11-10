import React, { useState } from 'react';
import Drawer from '../../components/Drawer';
import { gameDescription, marketGroups } from './markets';

export default function MarketPicker({ game, onClose, onAdd }) {
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groups = marketGroups(game);
  function toggle(id) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  async function add() {
    setSaving(true); setError('');
    try { await onAdd(selected); }
    catch (failure) { setError(failure.message); setSaving(false); }
  }
  return <Drawer title={`Markets · ${game.team_a} vs ${game.team_b}`} onClose={saving ? () => {} : onClose}>
    <p className="market-picker-intro">{gameDescription(game, { includeGoalies: true })} · Choose markets to add to Sends. Enter play-to prices on the draft card.</p>
    <div className="market-checklists">{groups.map(group => <details key={group.id} open>
      <summary>{group.label}</summary>
      <div className="market-group-actions"><button type="button" disabled={saving} onClick={() => setSelected(current => [...new Set([...current, ...group.markets.filter(market => market.available).map(market => market.id)])])}>Select all available</button><button type="button" disabled={saving} onClick={() => setSelected(current => current.filter(id => !group.markets.some(market => market.id === id)))}>Clear</button></div>
      {group.markets.map(market => <label key={market.id} className={`market-check ${market.available ? '' : 'market-unavailable'}`}><input type="checkbox" disabled={saving || !market.available} checked={selected.includes(market.id)} onChange={() => toggle(market.id)} /><span>{market.label}{!market.available && <small>Unavailable in {game.series_format}</small>}</span></label>)}
    </details>)}</div>
    {error && <p role="alert" className="sends-error">{error}</p>}
    <div className="market-picker-footer"><span>{selected.length} selected</span><button type="button" className="button button-primary" disabled={!selected.length || saving} onClick={add}>{saving ? 'Saving…' : 'Add to Sends'}</button></div>
  </Drawer>;
}
