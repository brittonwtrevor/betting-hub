import React, { useEffect, useRef, useState } from 'react';
import { sports } from '../../app/navigation';
import { Panel, Segments } from '../../components/ui';
import './projects.css';

const endpoint = '/api/project-tasks';
const writeHeaders = { 'Content-Type': 'application/json', 'X-Betting-Hub': 'project-tasks' };
const levels = ['Low', 'Medium', 'High'];
const fields = [
  { key: 'category', label: 'Category', maxLength: 80 },
  { key: 'importance', label: 'Importance', options: levels },
  { key: 'taskName', label: 'Task Name', maxLength: 200 },
  { key: 'sport', label: 'Sport', maxLength: 80 },
  { key: 'effort', label: 'Effort', options: levels },
];
const statuses = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
];
const emptyTask = { category: '', importance: '', taskName: '', sport: '', effort: '', notes: '' };

async function requestTasks(options, fallback, path = endpoint) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message || fallback);
  return result;
}

export default function ProjectManagementPage() {
  const [draft, setDraft] = useState(emptyTask);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [updatingId, setUpdatingId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const draftId = useRef(null);
  const visibleTasks = tasks.filter(task => (task.status ?? 'pending') === statusFilter);
  const isCompleted = statusFilter === 'completed';
  const statusLabel = isCompleted ? 'Completed' : 'Pending';

  useEffect(() => {
    const controller = new AbortController();
    const fallback = 'Unable to load tasks. Try refreshing.';
    requestTasks({ signal: controller.signal }, fallback)
      .then(result => {
        if (!Array.isArray(result.tasks)) throw new Error(fallback);
        if (!controller.signal.aborted) setTasks(result.tasks);
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  function updateDraft(key, value) {
    draftId.current = null;
    setDraft(current => ({ ...current, [key]: value }));
    setSaveError('');
  }

  async function createTask(event) {
    event.preventDefault();
    if (saving || loading) return;
    const fallback = 'Unable to save the task. Try again.';
    setSaving(true);
    setSaveError('');
    try {
      draftId.current ??= window.crypto.randomUUID();
      const { task } = await requestTasks({
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ id: draftId.current, ...draft }),
      }, fallback);
      if (task?.id !== draftId.current) throw new Error(fallback);
      setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
      setStatusFilter('pending');
      setDraft(emptyTask);
      draftId.current = null;
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(id) {
    if (loading || updatingId) return;
    const status = isCompleted ? 'pending' : 'completed';
    const fallback = 'Unable to update task status. Try again.';
    setUpdatingId(id);
    setStatusError('');
    try {
      const { task } = await requestTasks({
        method: 'PATCH',
        headers: writeHeaders,
        body: JSON.stringify({ status }),
      }, fallback, `${endpoint}/${encodeURIComponent(id)}`);
      if (task?.id !== id || !statuses.some(option => option.value === task.status)) throw new Error(fallback);
      setTasks(current => current.map(item => item.id === id ? { ...item, status: task.status } : item));
    } catch (error) {
      setStatusError(error.message);
    } finally {
      setUpdatingId(null);
    }
  }

  function refreshTasks() {
    setLoading(true);
    setLoadError('');
    setStatusError('');
    setRefresh(value => value + 1);
  }

  return <>
    <h1>Project Management</h1>
    <Panel title="New task">
      <form className="project-form" onSubmit={createTask}>
        <div className="project-fields">
          {fields.map(({ key, label, maxLength, options }) => {
            const props = {
              required: true,
              disabled: saving,
              value: draft[key],
              onChange: event => updateDraft(key, event.target.value),
            };
            return <label key={key}>
              <span>{label}</span>
              {options ? <select {...props}>
                <option value="">Select {label.toLowerCase()}</option>
                {options.map(option => <option key={option}>{option}</option>)}
              </select> : <input {...props} maxLength={maxLength} list={key === 'sport' ? 'project-sports' : undefined} />}
            </label>;
          })}
          <label className="project-notes-field">
            <span>Notes (optional)</span>
            <textarea rows={4} maxLength={5000} disabled={saving} value={draft.notes}
              onChange={event => updateDraft('notes', event.target.value)}
              placeholder="Add task specs, requirements, or context" />
          </label>
        </div>
        <datalist id="project-sports">
          {sports.map(sport => <option key={sport.id} value={sport.label} />)}
          <option value="All sports" />
        </datalist>
        <button type="submit" className="button button-primary" disabled={saving || loading}>
          {saving ? 'Saving…' : 'Add task'}
        </button>
        {saveError && <p role="alert" className="project-message">{saveError}</p>}
      </form>
    </Panel>
    <Panel title="Tasks" action={
      <button type="button" className="button button-secondary" disabled={loading || saving || !!updatingId} onClick={refreshTasks}>
        Refresh tasks
      </button>
    }>
      <div className="project-filters">
        <Segments label="Filter tasks by status" items={statuses} value={statusFilter} onChange={setStatusFilter} />
      </div>
      {loading && <p role="status" className="project-message">Loading tasks…</p>}
      {loadError && <p role="alert" className="project-message">{loadError}</p>}
      {statusError && <p role="alert" className="project-message">{statusError}</p>}
      <div className="table-scroll">
        <table className="data-table project-table" aria-label="Project tasks">
          <thead><tr>
            {fields.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}
            <th scope="col">Status</th>
          </tr></thead>
          {visibleTasks.map(task => <tbody key={task.id} className="project-task">
            <tr className="project-task-row" tabIndex={task.notes ? 0 : undefined}>
              {fields.map(({ key }) => <td key={key}>{task[key]}</td>)}
              <td>
                <button type="button" className={`button project-status project-status-${statusFilter}`}
                  disabled={loading || !!updatingId} onClick={() => toggleStatus(task.id)}
                  title={isCompleted ? 'Mark as pending' : 'Mark as completed'}>
                  {updatingId === task.id ? 'Saving…' : statusLabel}
                </button>
              </td>
            </tr>
            {task.notes && <tr className="project-task-notes">
              <td colSpan={fields.length + 1}>
                <strong>Notes</strong>
                <div className="project-note-text" tabIndex={0}>{task.notes}</div>
              </td>
            </tr>}
          </tbody>)}
          {!loading && !loadError && !visibleTasks.length && <tbody><tr>
            <td colSpan={fields.length + 1}>
              No {statusFilter} tasks.
            </td>
          </tr></tbody>}
        </table>
      </div>
    </Panel>
  </>;
}
