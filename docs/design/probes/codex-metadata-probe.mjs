// Synthetic inputs only. This calls the pure normalizer, never capture/flush.
import assert from 'node:assert/strict';
import { eventFromHook, validateConfig } from '../../../integrations/codex/timer-capture.mjs';

const config = validateConfig({
  mode: 'work-log',
  apiOrigin: 'http://127.0.0.1:3000',
  userId: '00000000-0000-4000-8000-000000000001',
  project: 'synthetic-project',
  shareAssistantSummary: false,
});
const input = {
  hook_event_name: 'PostToolUse',
  session_id: 'synthetic-thread',
  turn_id: 'synthetic-turn',
  tool_use_id: 'synthetic-tool',
  tool_name: 'Bash',
  tool_input: { command: 'printf synthetic-content' },
  tool_response: { exit_code: 0, stdout: 'synthetic-output' },
  cwd: '/synthetic/private/project',
  occurred_at: '2026-09-12T12:00:00.000Z',
};
const first = eventFromHook(input, config, new Date('2026-09-12T12:00:05.000Z'));
const again = eventFromHook(input, config, new Date('2026-09-12T12:00:09.000Z'));
assert(first && again);
assert.equal(first.id, again.id);
assert.notEqual(first.occurredAt, again.occurredAt);
assert.equal(first.occurredAt, '2026-09-12T12:00:05.000Z');
for (const key of ['turn_id', 'tool_use_id', 'cwd', 'tool_input', 'tool_response']) {
  assert.equal(key in first, false);
}
const stop = eventFromHook({
  hook_event_name: 'Stop', session_id: 'synthetic-thread', turn_id: 'synthetic-turn',
  last_assistant_message: 'Synthetic private assistant text',
}, config);
assert(stop);
assert.equal(stop.summary, 'Assistant turn completed.');
console.log(JSON.stringify({
  kind: first.kind,
  summary: first.summary,
  retainedKeys: Object.keys(first),
  stableIdWithInvocation: true,
  timeBasis: 'adapter invocation clock',
  duplicateNormalizationChangesTimestamp: true,
  assistantTextDisabled: true,
  rawContentRetained: false,
  networkCalls: 0,
}, null, 2));
