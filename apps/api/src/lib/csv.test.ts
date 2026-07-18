import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,desc\n"Shea, pure","x"')).toEqual([
      ['name', 'desc'],
      ['Shea, pure', 'x'],
    ]);
  });

  it('handles doubled quotes inside quoted fields', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty lines as a single-empty-field row', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      [''],
      ['1', '2'],
      [''],
    ]);
  });

  it('treats a mid-field quote as a literal character', () => {
    expect(parseCsv('a,b\n5" nail polish,x')).toEqual([
      ['a', 'b'],
      ['5" nail polish', 'x'],
    ]);
  });
});
