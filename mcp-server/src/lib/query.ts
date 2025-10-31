import { LogEvent } from "../types";

export function buildPredicate(filter: string | undefined): (row: LogEvent) => boolean {
  if (!filter || !filter.trim()) return () => true;
  const tokens = tokenize(filter);
  const ast = parseExpression(tokens);
  return (row: LogEvent) => evalAst(ast, row);
}

type Token = { t: string; v: string };

function tokenize(s: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, buf = '';
      while (j < s.length && s[j] !== '"') { buf += s[j++]; }
      toks.push({ t: 'str', v: buf }); i = j + 1; continue;
    }
    if (/[()]/.test(ch)) { toks.push({ t: ch, v: ch }); i++; continue; }
    const two = s.slice(i, i+2);
    if (["==","~=","<=",">="] .includes(two)) { toks.push({ t: two, v: two }); i+=2; continue; }
    if (["<",">"] .includes(ch)) { toks.push({ t: ch, v: ch }); i++; continue; }
    const m = /^(and|or|not)/i.exec(s.slice(i));
    if (m) { toks.push({ t: m[1].toLowerCase(), v: m[1].toLowerCase() }); i += m[0].length; continue; }
    const id = /^[a-zA-Z0-9_\.]+/.exec(s.slice(i));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    toks.push({ t: 'chr', v: ch }); i++;
  }
  return toks;
}

interface Node { kind: string }
interface Bin extends Node { op: string; left: Node; right: Node }
interface Un extends Node { op: string; expr: Node }
interface Pred extends Node { field: string; cmp: string; value?: string }

function parseExpression(tokens: Token[]): Node {
  let i = 0;
  function parsePrimary(): Node {
    const tok = tokens[i]; if (!tok) return { kind: 'true' } as Node;
    if (tok.t === '(') { i++; const e = parseOr(); if (tokens[i]?.t===')') i++; return e; }
    if (tok.t === 'not') { i++; return { kind:'un', op:'not', expr: parsePrimary() } as Un; }
    if (tok.t === 'id') {
      const field = tokens[i++].v;
      if (tokens[i] && ["==","~=","<",">","<=",">="] .includes(tokens[i].t)) {
        const cmp = tokens[i++].t;
        const valTok = tokens[i];
        if (valTok && (valTok.t==='str' || valTok.t==='id')) { i++; return { kind:'pred', field, cmp, value: valTok.v } as Pred; }
        return { kind:'pred', field, cmp } as Pred;
      }
      if (field.toLowerCase()==='exists' && tokens[i]?.t==='(' && tokens[i+1]?.t==='id' && tokens[i+2]?.t===')') {
        i+=3; return { kind:'pred', field: tokens[i-2].v, cmp: 'exists' } as Pred;
      }
      return { kind:'pred', field, cmp: 'exists' } as Pred;
    }
    i++; return { kind:'true' } as Node;
  }
  function parseAnd(): Node {
    let left = parsePrimary();
    while (tokens[i]?.t === 'and') { i++; left = { kind:'bin', op:'and', left, right: parsePrimary() } as Bin; }
    return left;
  }
  function parseOr(): Node {
    let left = parseAnd();
    while (tokens[i]?.t === 'or') { i++; left = { kind:'bin', op:'or', left, right: parseAnd() } as Bin; }
    return left;
  }
  return parseOr();
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
}

function evalAst(n: Node, row: LogEvent): boolean {
  switch (n.kind) {
    case 'true': return true;
    case 'un': return !evalAst((n as Un).expr, row);
    case 'bin': {
      const b = n as Bin;
      return b.op==='and' ? (evalAst(b.left,row) && evalAst(b.right,row)) : (evalAst(b.left,row) || evalAst(b.right,row));
    }
    case 'pred': {
      const p = n as Pred;
      if (p.cmp === 'exists') return getPath(row, p.field) !== undefined;
      const v = getPath(row, p.field); if (v == null) return false;
      const sv = String(v); const rhs = p.value ?? '';
      switch (p.cmp) {
        case '==': return sv === rhs;
        case '~=': return new RegExp(rhs).test(sv);
        case '<': return Number(sv) < Number(rhs);
        case '>': return Number(sv) > Number(rhs);
        case '<=': return Number(sv) <= Number(rhs);
        case '>=': return Number(sv) >= Number(rhs);
        default: return false;
      }
    }
    default: return true;
  }
}
