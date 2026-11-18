/** Strict JSON with top-level lexical values. No eval and no numeric rewriting. */
export function parseJsonLexemes(text: string): {value: unknown; lexemes: Record<string, string>} {
  let position = 0, nodes = 0;
  const lexemes: Record<string, string> = Object.create(null);
  const fail = (): never => { throw new Error('INVALID_OR_DUPLICATE_JSON'); };
  const white = () => { while (position < text.length && /[ \t\r\n]/.test(text[position])) position++; };
  function string(): string {
    const start = position;
    if (text[position++] !== '"') fail();
    let escaped = false;
    while (position < text.length) {
      const c = text[position++];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') return JSON.parse(text.slice(start, position));
    }
    return fail();
  }
  function value(depth: number): void {
    if (depth > 64 || ++nodes > 50000) fail();
    white();
    const c = text[position];
    if (c === '"') { string(); return; }
    if (c === '{') {
      position++; white(); const keys = new Set<string>();
      if (text[position] === '}') { position++; return; }
      while (position < text.length) {
        const key = string(); if (keys.has(key)) fail(); keys.add(key);
        white(); if (text[position++] !== ':') fail(); white(); const start = position;
        value(depth + 1);
        if (depth === 0) lexemes[key] = text.slice(start, position);
        white(); const delimiter = text[position++];
        if (delimiter === '}') return;
        if (delimiter !== ',') fail(); white();
      }
      return fail();
    }
    if (c === '[') {
      position++; white(); if (text[position] === ']') { position++; return; }
      while (position < text.length) {
        value(depth + 1); white(); const delimiter = text[position++];
        if (delimiter === ']') return;
        if (delimiter !== ',') fail(); white();
      }
      return fail();
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(position));
    if (!primitive) fail(); position += primitive![0].length;
  }
  white(); value(0); white(); if (position !== text.length) fail();
  return {value: JSON.parse(text), lexemes};
}
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.join() === bk.join() && ak.every(k => sameJsonValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
