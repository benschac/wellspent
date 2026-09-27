// Millisecond budgets; acknowledgement waiting starts after HTTP admission.
export const HARNESS_TIMEOUTS = {
  fetchMs: 3000,
  acknowledgementMs: 10000,
  pollMs: 50,
  // Let already-buffered SDK messages finish before interrupting work on EOF.
  eofGraceMs: 1000,
} as const;
