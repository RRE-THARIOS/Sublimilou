/** File d’attente infinie (cycle sur la source) */
export const QUEUE_VISIBLE = 15;

export function cycleIds(sourceIds, startInSource, count) {
  if (!sourceIds.length || count <= 0) return [];
  const n = sourceIds.length;
  const start = ((startInSource % n) + n) % n;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(sourceIds[(start + i) % n]);
  }
  return out;
}

export function buildQueueFromSource(sourceIds, startIndex, minLength) {
  if (!sourceIds.length) return [];
  const min = Math.max(minLength, sourceIds.length, startIndex + 1 + QUEUE_VISIBLE);
  const q = [];
  for (let pos = 0; pos < min; pos++) {
    q.push(sourceIds[pos % sourceIds.length]);
  }
  return q;
}
