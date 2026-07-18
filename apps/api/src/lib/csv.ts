/**
 * Minimal RFC 4180 style CSV parser for the product import: quoted fields may
 * contain commas, newlines, and doubled quotes. Empty physical lines are
 * preserved as a single-empty-field row (the caller decides whether to skip
 * them); only the flush at end of input avoids a phantom trailing row for a
 * file that ends with a newline. No streaming: import files are capped at
 * 1MB / 200 rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      if (field === '') {
        inQuotes = true;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r' && text[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }
    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    pushRow();
  }
  return rows;
}
