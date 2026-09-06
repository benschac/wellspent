import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configure, enqueue, eventFromHook, flush, loadConfig, queueStatus, validateConfig } from './timer-capture.mjs';

const directories = [];
const config = validateConfig({ apiOrigin: 'https://timer.example', sessionId: 'c10b8783-e660-4e87-b378-7e754658084c' });
const hook = { hook_event_name: 'PostToolUse', session_id: 'thread_1', turn_id: 'turn_1', tool_use_id: 'call_1', tool_name: 'Bash', tool_input: { command: 'cat /Users/alice/private.txt TOKEN=secret' }, tool_response: { exit_code: 0, output: 'private transcript sk-secret' }, cwd: '/Users/alice/private', transcript_path: '/Users/alice/transcript.jsonl' };
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'timer-codex-'));
  directories.push(directory);
  const path = join(directory, 'private', 'config.json');
  await configure(path, config);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function acknowledgeAll(_url, options) {
  return Promise.resolve(Response.json({ acceptedEventIds: JSON.parse(options.body).events.map(({ id }) => id) }));
}

describe('metadata capture', () => {
  test('captures only allowlisted metadata, never raw inputs, output, paths or prompts', () => {
    const event = eventFromHook(hook, config, new Date('2026-09-05T12:00:00Z'));
    expect(event.summary).toBe('Tool completed: Bash (reported success).');
    expect(JSON.stringify(event)).not.toMatch(/alice|private|secret|transcript|TOKEN|command/);
    expect(event.occurredAt).toBe('2026-09-05T12:00:00.000Z');
    expect(eventFromHook({ ...hook, tool_response: 'exit code 0' }, config).summary).toBe('Tool completed: Bash.');
  });
  test('turn text requires explicit consent and remains agent-reported', () => {
    const input = { ...hook, hook_event_name: 'Stop', last_assistant_message: 'Fixed login in /Users/alice/code. token=private' };
    expect(eventFromHook(input, config).summary).toBe('Assistant turn completed.');
    const shared = eventFromHook(input, { ...config, shareAssistantSummary: true });
    expect(shared.summary).toStartWith('Agent-reported: Fixed login');
    expect(shared.summary).not.toMatch(/alice|private/);
    expect(eventFromHook({ ...input, last_assistant_message: 'a'.repeat(4000) }, { ...config, shareAssistantSummary: true }).summary.length).toBeLessThanOrEqual(2000);
  });
  test('ignores unsupported events and its own capture commands', () => {
    expect(eventFromHook({ ...hook, hook_event_name: 'UserPromptSubmit' }, config)).toBeNull();
    expect(eventFromHook({ ...hook, tool_input: { command: 'node /opt/timer-capture.mjs flush' } }, config)).toBeNull();
    expect(eventFromHook({ ...hook, tool_name: 'mcp__timer__capture_work_events' }, config)).toBeNull();
  });
  test('normalizes unexpected thread identifiers without leaking absolute paths', () => {
    expect(eventFromHook({ ...hook, session_id: '/Users/alice/session' }, config).sourceSessionId).toMatch(/^thread_[a-f0-9]{64}$/);
  });
});

describe('durable delivery', () => {
  test('repeated delivery has a stable UUID and preserves original queued time', async () => {
    const path = await setup();
    const original = eventFromHook(hook, config, new Date('2026-09-05T12:00:00Z'));
    const duplicate = eventFromHook(hook, config, new Date('2026-09-05T12:05:00Z'));
    expect(original.id).toBe(duplicate.id);
    expect(await enqueue(path, config, original)).toBe(true);
    expect(await enqueue(path, config, duplicate)).toBe(false);
    expect((await queueStatus(path, config)).currentSession).toBe(1);
    await flush(path, config, { token: 'test-token', fetchImpl: async (_url, options) => {
      expect(JSON.parse(options.body).events[0].occurredAt).toBe(original.occurredAt);
      return acknowledgeAll(_url, options);
    } });
  });
  test('duplicate delivery after acknowledgment is skipped without changing its timestamp', async () => {
    const path = await setup();
    const original = eventFromHook(hook, config, new Date('2026-09-05T12:00:00Z'));
    await enqueue(path, config, original);
    expect((await flush(path, config, { token: 'test', fetchImpl: acknowledgeAll })).acknowledged).toBe(1);
    const repeated = eventFromHook(hook, config, new Date('2026-09-05T12:05:00Z'));
    expect(repeated.id).toBe(original.id);
    expect(await enqueue(path, config, repeated)).toBe(false);
    let requests = 0;
    await flush(path, config, { token: 'test', fetchImpl: async () => { requests++; throw new Error('Unexpected duplicate'); } });
    expect(requests).toBe(0);
    expect((await queueStatus(path, config)).currentSession).toBe(0);
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    const receipt = join(root, folder, `${original.id}.ack`);
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual({ id: original.id });
    expect((await stat(receipt)).mode & 0o777).toBe(0o600);
  });
  test('concurrent delivery and acknowledgment send only the original event', async () => {
    const path = await setup();
    const original = eventFromHook(hook, config, new Date('2026-09-05T12:00:00Z'));
    await enqueue(path, config, original);
    const delivered = [];
    const upload = flush(path, config, { token: 'test', fetchImpl: async (url, options) => {
      delivered.push(...JSON.parse(options.body).events);
      await Promise.all(Array.from({ length: 8 }, () => enqueue(path, config, eventFromHook(hook, config, new Date('2026-09-05T12:05:00Z')))));
      return acknowledgeAll(url, options);
    } });
    await Promise.all([upload, ...Array.from({ length: 8 }, () => enqueue(path, config, eventFromHook(hook, config, new Date('2026-09-05T12:10:00Z'))))]);
    expect(delivered).toEqual([original]);
    expect(await enqueue(path, config, eventFromHook(hook, config))).toBe(false);
    expect((await queueStatus(path, config)).currentSession).toBe(0);
  });
  test('a receipt surviving interrupted deletion suppresses stale queued data', async () => {
    const path = await setup();
    const event = eventFromHook(hook, config);
    await enqueue(path, config, event);
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    await writeFile(join(root, folder, `${event.id}.ack`), JSON.stringify({ id: event.id }), { mode: 0o600 });
    let requests = 0;
    await flush(path, config, { token: 'test', fetchImpl: async () => { requests++; throw new Error('Unexpected retry'); } });
    expect(requests).toBe(0);
    expect((await queueStatus(path, config)).currentSession).toBe(0);
  });
  test('tampered queue fields are rejected locally before upload', async () => {
    const path = await setup();
    const event = eventFromHook(hook, config);
    await enqueue(path, config, event);
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    await writeFile(join(root, folder, `${event.id}.json`), JSON.stringify({ apiOrigin: config.apiOrigin, sessionId: config.sessionId, event: { ...event, rawOutput: 'private' } }), { mode: 0o600 });
    let requests = 0;
    await expect(flush(path, config, { token: 'test', fetchImpl: async () => { requests++; throw new Error('Unexpected upload'); } })).rejects.toThrow('local review');
    expect(requests).toBe(0);
    expect((await queueStatus(path, config)).currentSession).toBe(1);
  });
  test('offline or expired credentials retain data and retry the same IDs', async () => {
    const path = await setup();
    const event = eventFromHook(hook, config);
    await enqueue(path, config, event);
    const offline = await flush(path, config, { token: 'test-token', fetchImpl: async () => { throw new Error('offline'); } });
    expect(offline.reason).toBe('offline_or_unacknowledged');
    expect((await queueStatus(path, config)).currentSession).toBe(1);
    expect((await flush(path, config, { token: 'expired', fetchImpl: async () => new Response('', { status: 401 }) })).reason).toBe('token_expired_or_revoked');
    const result = await flush(path, config, { token: 'reissued', fetchImpl: async (url, options) => {
      expect(url).toBe(`${config.apiOrigin}/api/focus/sessions/${config.sessionId}/work-events`);
      expect(options.headers.Authorization).toBe('Bearer reissued');
      expect(JSON.parse(options.body).events[0].id).toBe(event.id);
      return acknowledgeAll(url, options);
    } });
    expect(result.acknowledged).toBe(1);
    expect((await queueStatus(path, config)).currentSession).toBe(0);
  });
  test('removes only explicitly acknowledged events', async () => {
    const path = await setup();
    const first = eventFromHook(hook, config);
    const second = eventFromHook({ ...hook, tool_use_id: 'call_2' }, config);
    await enqueue(path, config, first);
    await enqueue(path, config, second);
    expect(await flush(path, config, { token: 'test', fetchImpl: async () => Response.json({ acceptedEventIds: [first.id] }) })).toEqual({ acknowledged: 1, quarantined: 0, reason: 'partial_acknowledgment' });
    expect((await queueStatus(path, config)).currentSession).toBe(1);
    expect((await flush(path, config, { token: 'test', fetchImpl: async () => Response.json({ ok: true }) })).acknowledged).toBe(0);
    expect((await queueStatus(path, config)).currentSession).toBe(1);
  });
  test('batches at 50 and retains subsequent batches after failed upload', async () => {
    const path = await setup();
    for (let index = 0; index < 51; index++) await enqueue(path, config, eventFromHook({ ...hook, tool_use_id: `call_${index}` }, config));
    let calls = 0;
    const result = await flush(path, config, { token: 'test', maxBatches: 2, fetchImpl: async (url, options) => {
      const events = JSON.parse(options.body).events;
      expect(events.length).toBeLessThanOrEqual(50);
      if (calls++ === 0) return acknowledgeAll(url, options);
      return new Response('', { status: 503 });
    } });
    expect(result.acknowledged).toBe(50);
    expect((await queueStatus(path, config)).currentSession).toBe(1);
  });
  test('mixed accepted and rejected batches preserve rejected originals and flush later valid events', async () => {
    const path = await setup();
    const originals = new Map();
    for (let index = 0; index < 55; index++) {
      const event = eventFromHook({ ...hook, tool_use_id: `mixed_${index}` }, config, new Date('2026-09-05T12:00:00Z'));
      originals.set(event.id, event);
      await enqueue(path, config, event);
    }
    let calls = 0;
    let quarantinedIds;
    const result = await flush(path, config, { token: 'test', maxBatches: 2, fetchImpl: async (url, options) => {
      const events = JSON.parse(options.body).events;
      if (calls++ === 0) {
        quarantinedIds = events.slice(0, 2).map(({ id }) => id);
        return Response.json({ acceptedEventIds: events.slice(2).map(({ id }) => id), rejectedEvents: [
          { id: events[0].id, reason: 'outside_session' }, { id: events[1].id, reason: 'session_limit' },
        ] });
      }
      return acknowledgeAll(url, options);
    } });
    expect(result).toEqual({ acknowledged: 53, quarantined: 2, reason: 'complete' });
    expect(calls).toBe(2);
    expect(await queueStatus(path, config)).toMatchObject({ currentSession: 0, currentSessionRejected: 2, otherSessionsRejected: 0, rejectedByReason: { currentSession: { outside_session: 1, session_limit: 1 } } });
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    for (const id of quarantinedIds) {
      const file = join(root, folder, `${id}.rejected`);
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ apiOrigin: config.apiOrigin, sessionId: config.sessionId, event: originals.get(id) });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await enqueue(path, config, { ...originals.get(id), occurredAt: '2026-09-05T12:10:00.000Z' })).toBe(false);
    }
    const changed = await configure(path, { ...config, sessionId: 'd10b8783-e660-4e87-b378-7e754658084c' });
    expect(await queueStatus(path, changed)).toMatchObject({ currentSessionRejected: 0, otherSessionsRejected: 2, rejectedByReason: { otherSessions: { outside_session: 1, session_limit: 1 } } });
  });
  test('unknown, overlapping, duplicate or invalid dispositions retain the entire batch', async () => {
    const path = await setup();
    const first = eventFromHook(hook, config);
    const second = eventFromHook({ ...hook, tool_use_id: 'other' }, config);
    await enqueue(path, config, first);
    await enqueue(path, config, second);
    const responses = [
      { acceptedEventIds: [first.id, crypto.randomUUID()] },
      { acceptedEventIds: [first.id, first.id] },
      { acceptedEventIds: [first.id], rejectedEvents: [{ id: first.id, reason: 'outside_session' }] },
      { acceptedEventIds: [first.id], rejectedEvents: [{ id: second.id, reason: 'delete_everything' }] },
      { acceptedEventIds: [first.id], rejectedEvents: [{ id: crypto.randomUUID(), reason: 'session_limit' }] },
      { acceptedEventIds: [first.id], rejectedEvents: [{ id: second.id, reason: 'future_timestamp' }, { id: second.id, reason: 'id_conflict' }] },
      { acceptedEventIds: [first.id], rejectedEvents: 'invalid' },
      null,
    ];
    for (const body of responses) {
      expect(await flush(path, config, { token: 'test', fetchImpl: async () => Response.json(body) })).toEqual({ acknowledged: 0, quarantined: 0, reason: 'invalid_acknowledgment' });
      expect(await queueStatus(path, config)).toMatchObject({ currentSession: 2, currentSessionRejected: 0 });
    }
  });
  test('durable quarantine survives interrupted active-file deletion without resending', async () => {
    const path = await setup();
    const event = eventFromHook(hook, config);
    await enqueue(path, config, event);
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    await writeFile(join(root, folder, `${event.id}.rejected`), JSON.stringify({ apiOrigin: config.apiOrigin, sessionId: config.sessionId, event, reason: 'id_conflict' }), { mode: 0o600 });
    let requests = 0;
    await flush(path, config, { token: 'test', fetchImpl: async () => { requests++; throw new Error('Unexpected retry'); } });
    expect(requests).toBe(0);
    expect(await queueStatus(path, config)).toMatchObject({ currentSession: 0, currentSessionRejected: 1 });
    expect(await enqueue(path, config, event)).toBe(false);
  });
  test('switching configuration never retargets previously queued events', async () => {
    const path = await setup();
    const original = eventFromHook(hook, config);
    await enqueue(path, config, original);
    const changed = await configure(path, { ...config, sessionId: 'd10b8783-e660-4e87-b378-7e754658084c' });
    await enqueue(path, changed, eventFromHook(hook, changed));
    await flush(path, changed, { token: 'new-session', fetchImpl: async (url, options) => {
      expect(url).toContain(changed.sessionId);
      expect(JSON.parse(options.body).events.map(({ id }) => id)).not.toContain(original.id);
      return acknowledgeAll(url, options);
    } });
    expect(await queueStatus(path, changed)).toMatchObject({ currentSession: 0, otherSessions: 1 });
    await configure(path, config);
    expect((await flush(path, config, { token: 'original-session', fetchImpl: acknowledgeAll })).acknowledged).toBe(1);
  });
  test('configuration and queue use private permissions and store no credential', async () => {
    const path = await setup();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
    expect(await loadConfig(path)).toEqual(config);
    expect(await readFile(path, 'utf8')).not.toContain('TOKEN');
    await enqueue(path, config, eventFromHook(hook, config));
    const root = join(path, '..', 'spool');
    const [folder] = await readdir(root);
    expect((await stat(join(root, folder))).mode & 0o777).toBe(0o700);
    const [file] = await readdir(join(root, folder));
    expect((await stat(join(root, folder, file))).mode & 0o777).toBe(0o600);
    expect(() => validateConfig({ ...config, captureToken: 'secret' })).toThrow('Keep the token out');
    expect(() => validateConfig({ ...config, apiOrigin: 'http://untrusted.example' })).toThrow('HTTPS');
  });
});
