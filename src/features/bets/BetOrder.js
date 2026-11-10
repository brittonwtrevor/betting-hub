import React from 'react';
import { SelectField, sportOptions } from '../../components/ui';

export function BetOrder({ value, onChange, dateLabel }) {
  return <SelectField label="Sort by" value={value} onChange={onChange} options={[
    { value: 'newest', label: `${dateLabel} · Newest first` },
    { value: 'oldest', label: `${dateLabel} · Oldest first` },
    { value: 'sport-newest', label: 'Sport (A–Z) · Newest first' },
    { value: 'sport-oldest', label: 'Sport (A–Z) · Oldest first' },
  ]} />;
}

export function sportLabel(sport) {
  return sportOptions.find(option => option.value === sport)?.label || sport || '';
}

function compareValues(left, right, direction = 1) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction * left.localeCompare(right);
}

export function sortByBetOrder(records, order, sortKeys) {
  const bySport = order.startsWith('sport-');
  const dateDirection = order.endsWith('oldest') ? 1 : -1;
  return records.map(record => ({ record, ...sortKeys(record) }))
    .sort((left, right) => (bySport ? compareValues(left.sport, right.sport) : 0)
      || compareValues(left.date, right.date, dateDirection))
    .map(({ record }) => record);
}
