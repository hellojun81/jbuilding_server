export function normalizeQueryValue(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value;
}

export function normalizeQueryRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeQueryValue(value)]),
  ));
}
