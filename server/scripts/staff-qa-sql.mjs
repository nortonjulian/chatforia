// Split PostgreSQL scripts without splitting quoted strings or dollar bodies.
// Used only for trusted repository migrations, never request input.
export function sqlStatements(source) {
  const statements = [];
  let start = 0,
    quote = null,
    line = false,
    block = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      next = source[i + 1];
    if (line) {
      if (c === '\n') line = false;
      continue;
    }
    if (block) {
      if (c === '*' && next === '/') {
        block = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (source.startsWith(quote, i)) {
        if (quote.length === 1 && next === quote) i++;
        else {
          i += quote.length - 1;
          quote = null;
        }
      }
      continue;
    }
    if (c === '-' && next === '-') {
      line = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      block = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '$') {
      const match = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) {
        quote = match[0];
        i += quote.length - 1;
        continue;
      }
    }
    if (c === ';') {
      statements.push(source.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (quote || block) throw new Error('Unterminated SQL quote');
  if (source.slice(start).trim()) statements.push(source.slice(start));
  return statements.filter((sql) => sql.replace(/--[^\n]*/g, '').trim());
}
