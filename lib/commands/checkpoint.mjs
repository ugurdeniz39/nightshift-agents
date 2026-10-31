export const summary = 'Persist progress for the next session (--verified/--failed/--blocker/--note/--building/--automation)';
export const options = {
  verified: { type: 'string' },
  failed: { type: 'string' },
  blocker: { type: 'string' },
  note: { type: 'string' },
  building: { type: 'string' },
  automation: { type: 'string' },
  'automation-note': { type: 'string' },
};

const AUTOMATION_STATES = ['not-configured', 'configured', 'verified'];

export function run(ctx) {
  const a = ctx.args;
  const state = ctx.load().state;
  const at = ctx.now().toISOString();
  const entry = (text) => ({ at, text });
  const next = { ...state, updated: at };
  let changed = false;

  if (a.building) { next.building = a.building; changed = true; }
  for (const [flag, key] of [['verified', 'verified'], ['failed', 'failed'], ['blocker', 'blockers'], ['note', 'notes']]) {
    if (a[flag]) { next[key] = [...state[key], entry(a[flag])]; changed = true; }
  }
  if (a.automation) {
    if (!AUTOMATION_STATES.includes(a.automation)) {
      throw new Error(`--automation must be one of: ${AUTOMATION_STATES.join(', ')}`);
    }
    next.automation = { scheduled: a.automation, note: a['automation-note'] ?? '' };
    changed = true;
  }
  if (!changed) throw new Error('nothing to record: pass at least one of the options');
  ctx.save('state', next);
  ctx.out('checkpoint saved');
}
