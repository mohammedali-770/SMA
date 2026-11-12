/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A minimal RFC 4180 reader, written for the menu import.
 *
 * WHY IT EXISTS. The import split each line on every comma. Excel and Google
 * Sheets put any cell that holds a comma inside double quotes, so an ordinary
 * product name such as `"Wings, 12 pcs"` moved every later cell one column to
 * the right. The 2026-11-11 assessment measured a row priced 29.00 coming out
 * as price 12 and calories 29, with no warning, ready to be written to the live
 * menu. A cell holding a line break was cut in two the same way.
 *
 * WHAT IT READS — the shapes spreadsheets actually write:
 *
 *   - fields separated by commas, records by CRLF, LF or a lone CR;
 *   - a field that starts with `"` runs to the matching `"` and may hold
 *     commas and line breaks; `""` inside it is one literal quote. Spaces
 *     before the opening quote are padding, not content;
 *   - a leading UTF-8 byte-order mark. `FileReader.readAsText` already strips
 *     one from a chosen file, but a pasted text can still carry it.
 *
 * WHAT IT DOES NOT DO. It does not guess. A quoted field that never closes is
 * reported rather than repaired, because everything after the quote has been
 * swallowed into that one field. It does not trim: the caller decides what
 * whitespace means. And it cannot detect an encoding — by the time it runs the
 * bytes are already text, which is why the menu import checks for U+FFFD
 * itself.
 */

export interface CsvDocument {
  /** Every record in order, blank ones included, so record N is spreadsheet row N. */
  rows: string[][];
  /**
   * The 1-based record on which a quoted field opened and never closed, or
   * null. When it is set, everything after that quote is in one field.
   */
  unclosedQuoteRow: number | null;
}

const BOM = '\uFEFF';

export function readCsv(text: string): CsvDocument {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  // Whether the current field has already opened a quote. A second `"` later
  // in the same field is then literal text, as Excel treats it.
  let fieldWasQuoted = false;
  let inQuotes = false;
  let quoteOpenedOn = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"' && !fieldWasQuoted && /^[ \t]*$/.test(field)) {
      field = '';
      fieldWasQuoted = true;
      inQuotes = true;
      quoteOpenedOn = rows.length + 1;
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      endRecord();
      continue;
    }
    field += ch;
  }

  if (inQuotes) {
    endRecord();
    return { rows, unclosedQuoteRow: quoteOpenedOn };
  }
  // The last record, when the text does not end with a line break. A text that
  // DOES end with one has no empty record after it, which is how RFC 4180 and
  // every spreadsheet read it.
  if (field !== '' || row.length > 0 || fieldWasQuoted) endRecord();
  return { rows, unclosedQuoteRow: null };
}
