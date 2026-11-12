/**
 * The CSV reader under the menu import.
 *
 * Each case is a shape that Excel or Google Sheets really writes. The import
 * used to split every line on every comma, so the first case alone moved a
 * price into the calories column with no warning (2026-11-11 assessment).
 */
import { describe, expect, it } from 'vitest';

import { readCsv } from './csvReader';

const rows = (text: string) => readCsv(text).rows;

describe('readCsv — fields and records', () => {
  it('splits plain fields and records', () => {
    expect(readCsv('a,b,c\nd,e,f')).toEqual({
      rows: [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
      unclosedQuoteRow: null,
    });
  });

  it('keeps a comma inside a quoted field, so later cells stay in their columns', () => {
    expect(rows('Wings,"Wings, 12 pcs",29.00,450')).toEqual([['Wings', 'Wings, 12 pcs', '29.00', '450']]);
  });

  it('reads a doubled quote inside a quoted field as one literal quote', () => {
    expect(rows('"12"" pizza",x')).toEqual([['12" pizza', 'x']]);
    expect(rows('""""')).toEqual([['"']]);
  });

  it('keeps a line break inside a quoted field, so the record is not cut in two', () => {
    expect(rows('a,"line one\nline two",b\nc,d,e')).toEqual([
      ['a', 'line one\nline two', 'b'],
      ['c', 'd', 'e'],
    ]);
  });

  it('ends a record at CRLF, LF or a lone CR', () => {
    expect(rows('a\r\nb\nc\rd')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('keeps a CRLF inside a quoted field exactly as written', () => {
    expect(rows('a,"x\r\ny"\r\nb')).toEqual([['a', 'x\r\ny'], ['b']]);
  });

  it('keeps empty fields, trailing ones included', () => {
    expect(rows('a,,c,')).toEqual([['a', '', 'c', '']]);
    expect(rows('"",x')).toEqual([['', 'x']]);
  });

  it('keeps blank records, so record N is spreadsheet row N', () => {
    expect(rows('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('does not invent an empty record after a final line break', () => {
    expect(rows('a,b\n')).toEqual([['a', 'b']]);
    expect(rows('a,b\r\n')).toEqual([['a', 'b']]);
  });

  it('returns no records for empty text', () => {
    expect(readCsv('')).toEqual({ rows: [], unclosedQuoteRow: null });
  });
});

describe('readCsv — the edges spreadsheets and people produce', () => {
  it('drops a leading byte-order mark, and only a leading one', () => {
    expect(rows('\uFEFFa,b\nc,\uFEFFd')).toEqual([
      ['a', 'b'],
      ['c', '\uFEFFd'],
    ]);
  });

  it('treats spaces before an opening quote as padding', () => {
    expect(rows('a, "b, c",d')).toEqual([['a', 'b, c', 'd']]);
  });

  it('keeps text after a closing quote, as Excel does, for the caller to judge', () => {
    expect(rows('"b, c" ,d')).toEqual([['b, c ', 'd']]);
  });

  it('treats a quote in the middle of an unquoted field as text', () => {
    expect(rows('5" pizza,x')).toEqual([['5" pizza', 'x']]);
  });

  it('reports a quoted field that never closes, naming the row it opened on', () => {
    // Everything after the stray quote has been swallowed into one field, which
    // is why the menu import refuses the whole text rather than guessing.
    const doc = readCsv('header\nok,row\nbad,"never closed\nmore,rows');
    expect(doc.unclosedQuoteRow).toBe(3);
    expect(doc.rows[2]).toEqual(['bad', 'never closed\nmore,rows']);
  });
});
