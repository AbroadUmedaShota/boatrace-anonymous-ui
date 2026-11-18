/** JWT and pinned-config JSON must not contain duplicate decoded object keys. */
export function strictJson(text: string): unknown {
  if (text.length > 65536) throw new Error('JSON_LIMIT');
  let at = 0;
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw new Error('INVALID_JSON_STRING');
  }
  function value(depth: number): unknown {
    if (depth > 32) throw new Error('JSON_DEPTH'); space();
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      at++; space(); const result: Record<string, unknown> = Object.create(null);
      if (text[at] === '}') { at++; return result; }
      while (true) {
        space(); if (text[at] !== '"') throw new Error('JSON_KEY_REQUIRED');
        const key = string(); if (Object.hasOwn(result, key)) throw new Error('DUPLICATE_JSON_KEY');
        space(); if (text[at++] !== ':') throw new Error('JSON_COLON_REQUIRED');
        result[key] = value(depth + 1); space(); const next = text[at++];
        if (next === '}') return result; if (next !== ',') throw new Error('JSON_SEPARATOR_REQUIRED');
      }
    }
    if (text[at] === '[') {
      at++; space(); const result: unknown[] = [];
      if (text[at] === ']') { at++; return result; }
      while (true) { result.push(value(depth + 1)); space(); const next = text[at++];
        if (next === ']') return result; if (next !== ',') throw new Error('JSON_SEPARATOR_REQUIRED'); }
    }
    for (const [token, literal] of [['true', true], ['false', false], ['null', null]] as const)
      if (text.startsWith(token, at)) { at += token.length; return literal; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!match) throw new Error('INVALID_JSON_VALUE'); at += match[0].length;
    const number = Number(match[0]); if (!Number.isFinite(number)) throw new Error('NONFINITE_JSON'); return number;
  }
  const result = value(0); space(); if (at !== text.length) throw new Error('TRAILING_JSON'); return result;
}
