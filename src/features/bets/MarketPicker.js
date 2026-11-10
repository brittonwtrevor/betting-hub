import React, { useState } from 'react';
import Drawer from '../../components/Drawer';
import Icon from '../../components/Icon';
import { gameDescription, marketGroups } from './markets';

export default function MarketPicker({ game, onClose, onAdd }) {
  const [selected, setSelected] = useState([]);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const scenarios = game.scenarios;
  const scenario = scenarios?.[scenarioIndex] || game;
  const groups = marketGroups(scenario);
  function toggle(id) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  async function add() {
    setSaving(true); setError('');
    try { await onAdd(selected, scenario); }
    catch (failure) { setError(failure.message); setSaving(false); }
  }
  return <Drawer title={`Markets · ${game.team_a} vs ${game.team_b}`} onClose={saving ? () => {} : onClose}>
    <p className="market-picker-intro">{gameDescription(scenario, { includeGoalies: true })} · Choose markets to add to Sends. Enter play-to prices on the draft card.</p>
    {scenarios && <div className="select-field market-picker-scenario">
      <label htmlFor="market-picker-scenario">Goalie matchup</label>
      <div className="select-wrap"><select id="market-picker-scenario" value={scenarioIndex} disabled={saving} onChange={event => setScenarioIndex(Number(event.target.value))}>
        {scenarios.map((option, index) => <option key={index} value={index}>{option.goalie_team || 'Unknown home goalie'} vs {option.goalie_opp || 'Unknown away goalie'}</option>)}
      </select><Icon name="down" size={14} /></div>
    </div>}
    <div className="market-checklists">{groups.map(group => <details key={group.id} open>
      <summary>{group.label}</summary>
      <div className="market-group-actions"><button type="button" disabled={saving} onClick={() => setSelected(current => [...new Set([...current, ...group.markets.filter(market => market.available).map(market => market.id)])])}>Select all available</button><button type="button" disabled={saving} onClick={() => setSelected(current => current.filter(id => !group.markets.some(market => market.id === id)))}>Clear</button></div>
      {group.markets.map(market => <label key={market.id} className={`market-check ${market.available ? '' : 'market-unavailable'}`}><input type="checkbox" disabled={saving || !market.available} checked={selected.includes(market.id)} onChange={() => toggle(market.id)} /><span>{market.label}{!market.available && <small>Unavailable in {game.series_format}</small>}</span></label>)}
    </details>)}</div>
    {error && <p role="alert" className="sends-error">{error}</p>}
    <div className="market-picker-footer"><span>{selected.length} selected</span><button type="button" className="button button-primary" disabled={!selected.length || saving} onClick={add}>{saving ? 'Saving…' : 'Add to Sends'}</button></div>
  </Drawer>;
}
