import { describe, it, expect } from 'vitest';
import { stripIncoMarkdown } from './incoFormat';

describe('stripIncoMarkdown', () => {
  it('removes **bold** and __bold__', () => {
    expect(stripIncoMarkdown('**RUBS Sparta**: best burger')).toBe('RUBS Sparta: best burger');
    expect(stripIncoMarkdown('the __Jack Burger__ is great')).toBe('the Jack Burger is great');
  });

  it('converts "* "/"- "/"+ " bullets to "• " and strips bold inside', () => {
    const out = stripIncoMarkdown('* **Black John\'s**: nice\n- Raw Street\n+ Goody\'s');
    expect(out).toBe("• Black John's: nice\n• Raw Street\n• Goody's");
  });

  it('strips headings at line start', () => {
    expect(stripIncoMarkdown('# Title\n### Sub\nbody')).toBe('Title\nSub\nbody');
  });

  it('removes *italic* but leaves "2 * 3" and snake_case/URLs intact', () => {
    expect(stripIncoMarkdown('this is *important* ok')).toBe('this is important ok');
    expect(stripIncoMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(stripIncoMarkdown('see my_var and https://a.com/x_y')).toBe('see my_var and https://a.com/x_y');
  });

  it('unwraps [text](url) links to just the text and strips `code`', () => {
    expect(stripIncoMarkdown('try [efood](https://efood.gr) now')).toBe('try efood now');
    expect(stripIncoMarkdown('run `npm test` first')).toBe('run npm test first');
  });

  it('leaves clean prose untouched and trims', () => {
    expect(stripIncoMarkdown('  Just a normal sentence.  ')).toBe('Just a normal sentence.');
    expect(stripIncoMarkdown('')).toBe('');
  });
});
