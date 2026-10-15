import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';
import { htmlToPdf, imageSrc, registerFonts, renderers, sanitizeCss } from './pdfjs.ts';

const { div, img } = renderers();
const el = (attributes: Record<string, string>) => ({ attributes });
const styleOf = (node: any) => Object.assign({}, ...[node.props.style].flat());

// CSS flex defaults to row (Yoga defaults to column); explicit direction wins
assert.equal(styleOf(div({ style: [{ display: 'flex' }], element: el({}) })).flexDirection, 'row');
assert.equal(styleOf(div({ style: [{ display: 'flex', flexDirection: 'column' }], element: el({}) })).flexDirection, 'column');
assert.equal(styleOf(div({ style: [{ display: 'none' }], element: el({}) })).flexDirection, undefined);

// image policy
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pdfjs-')));
mkdirSync(join(root, 'site'));
writeFileSync(join(root, 'site', 'logo.png'), '');
writeFileSync(join(root, 'secret.png'), '');
symlinkSync(join(root, 'secret.png'), join(root, 'site', 'link.png'));
const site = { baseDir: join(root, 'site') };

assert.equal(imageSrc('data:image/png;base64,AA=='), 'data:image/png;base64,AA=='); // always allowed
assert.equal(imageSrc('logo.png'), null);                                          // no baseDir: no local files
assert.equal(imageSrc('logo.png', site), join(root, 'site', 'logo.png'));
assert.equal(imageSrc('./logo.png?v=2', site), join(root, 'site', 'logo.png'));
assert.equal(imageSrc('../secret.png', site), null);                               // ../ escape
assert.equal(imageSrc(join(root, 'secret.png'), site), null);                      // absolute path outside
assert.equal(imageSrc('link.png', site), null);                                    // symlink escape
assert.equal(imageSrc('missing.png', site), null);
assert.equal(imageSrc('file:///etc/hosts', site), null);                           // other schemes never
assert.equal(imageSrc('https://x.test/a.png', site), null);                        // remote off by default
assert.equal(imageSrc('https://x.test/a.png', { remote: true }), 'https://x.test/a.png');
assert.equal(img({ style: [], element: el({ src: 'http://x.test/a.png' }) }), null);

// intrinsic width when no size is given, explicit sizes win
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
assert.equal(styleOf(img({ style: [], element: el({ src: png1x1 }) })).width, 1);
assert.equal(styleOf(img({ style: [], element: el({ src: png1x1, width: '50' }) })).width, 50);
assert.equal(styleOf(img({ style: [{ width: '30%' }], element: el({ src: png1x1 }) })).width, '30%');

// a family without an italic file reuses its upright files instead of crashing on <i>
registerFonts({ OneFile: 'one.ttf', WithItalic: [{ src: 'r.ttf' }, { src: 'i.ttf', fontStyle: 'italic' }] });
const styles = (f: string) => Font.getRegisteredFonts()[f].sources.map((s: any) => `${s.src}:${s.fontStyle}`).sort();
assert.deepEqual(styles('OneFile'), ['one.ttf:italic', 'one.ttf:normal']);
assert.deepEqual(styles('WithItalic'), ['i.ttf:italic', 'r.ttf:normal']);

// sanitizeCss replaces border-width keywords that crash react-pdf
assert.equal(sanitizeCss('border: medium solid #000'), 'border: 3px solid #000');
assert.equal(sanitizeCss('border-width: thin'), 'border-width: 1px');
assert.equal(sanitizeCss('border-top: thick dashed red'), 'border-top: 5px dashed red');
assert.equal(sanitizeCss('border-bottom-width:medium'), 'border-bottom-width:3px');
assert.equal(sanitizeCss('color: medium'), 'color: medium'); // unrelated property untouched

// font stacks fall through to a family react-pdf can draw, like a browser; none -> dropped (inherits)
assert.equal(sanitizeCss(`font-family: "Segoe UI", Roboto, sans-serif;`), 'font-family: Helvetica;');
assert.equal(sanitizeCss('font-family:&quot;Segoe UI&quot;, serif'), 'font-family: Times-Roman;');
assert.equal(sanitizeCss('font-family: OneFile, monospace'), 'font-family: OneFile;'); // registered above
assert.equal(sanitizeCss('font-family: Foo; color: red'), ' color: red');
// `normal` gaps / spacings crash react-pdf, dropped
assert.equal(sanitizeCss('gap: normal; letter-spacing:normal;color:red'), ' color:red');
assert.equal(sanitizeCss('line-height: normal'), 'line-height: normal'); // supported, kept

// min-heights taller than the page are capped (react-pdf would loop forever placing them)
const section = renderers(undefined, 300).section;
assert.equal(styleOf(section({ style: [{ minHeight: '400px' }], element: el({}) })).minHeight, 300);
assert.equal(styleOf(section({ style: [{ minHeight: 200 }], element: el({}) })).minHeight, 200);
assert.equal(styleOf(section({ style: [{ minHeight: '50%' }], element: el({}) })).minHeight, '50%');

// end to end, no output -> Buffer; header/footer page numbers
const pdf = await htmlToPdf('<div style="display:flex;justify-content:space-between"><p>a</p><p>b</p></div>',
  { size: 'A5', landscape: true, margin: { top: 60 }, footer: '<p>{page}/{pages}</p>', meta: { title: 'T' } });
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.match(pdf.toString('latin1'), /\(T\)/);

// end to end: what used to crash or hang now renders, text content is left alone
const robust = await htmlToPdf(`<style>p { font-family: "Segoe UI", sans-serif; letter-spacing: normal }</style>
  <div style="display:flex;gap:normal;min-height:2000px"><p style="font-family:Foo">a</p></div><p>gap: normal</p>`, { size: [400, 300] });
assert.equal(robust.subarray(0, 5).toString(), '%PDF-');
console.log('ok');
