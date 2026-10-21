import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';
import { fillTemplate, formatNumber, htmlToPdf, imageSrc, mediaMatches, registerFonts, renderers, sanitizeCss, substituteVars } from './pdfjs.ts';

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

// intrinsic width when no size is given (1px = 0.75pt), explicit sizes win
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
assert.equal(styleOf(img({ style: [], element: el({ src: png1x1 }) })).width, 0.75);
assert.equal(styleOf(img({ style: [], element: el({ src: png1x1, width: '40' }) })).width, 30);
assert.equal(styleOf(img({ style: [{ width: '30%' }], element: el({ src: png1x1 }) })).width, '30%');

// a family without an italic file reuses its upright files instead of crashing on <i>
registerFonts({ OneFile: 'one.ttf', WithItalic: [{ src: 'r.ttf' }, { src: 'i.ttf', fontStyle: 'italic' }] });
const styles = (f: string) => Font.getRegisteredFonts()[f].sources.map((s: any) => `${s.src}:${s.fontStyle}`).sort();
assert.deepEqual(styles('OneFile'), ['one.ttf:italic', 'one.ttf:normal']);
assert.deepEqual(styles('WithItalic'), ['i.ttf:italic', 'r.ttf:normal']);

// sanitizeCss replaces border-width keywords that crash react-pdf
assert.equal(sanitizeCss('border: medium solid #000'), 'border: 2.25pt solid #000');
assert.equal(sanitizeCss('border-width: thin'), 'border-width: 0.75pt');
assert.equal(sanitizeCss('border-top: thick dashed red'), 'border-top: 3.75pt dashed red');
assert.equal(sanitizeCss('border-bottom-width:medium'), 'border-bottom-width:2.25pt');
assert.equal(sanitizeCss('color: medium'), 'color: medium'); // unrelated property untouched

// font stacks fall through to a family react-pdf can draw, like a browser; none -> dropped (inherits)
assert.equal(sanitizeCss(`font-family: "Segoe UI", Roboto, sans-serif;`), 'font-family: Helvetica;');
assert.equal(sanitizeCss('font-family:&quot;Segoe UI&quot;, serif'), 'font-family: Times-Roman;');
assert.equal(sanitizeCss('font-family: OneFile, monospace'), 'font-family: OneFile;'); // registered above
assert.equal(sanitizeCss('font-family: Foo; color: red'), ' color: red');
// `normal` gaps / spacings crash react-pdf, dropped
assert.equal(sanitizeCss('gap: normal; letter-spacing:normal;color:red'), ' color:red');
assert.equal(sanitizeCss('line-height: normal'), 'line-height: normal'); // supported, kept

// px like a browser: 1px = 0.75pt; other units and url() names untouched
assert.equal(sanitizeCss('margin: 16px -4px .5px 2em'), 'margin: 12pt -3pt 0.375pt 2em');
assert.equal(sanitizeCss('background: url(icon-16px.png)'), 'background: url(icon-16px.png)');

// var(): fallbacks, nesting, declarations dropped
assert.equal(substituteVars('--a: red; color: var(--a); border-color: var(--b, var(--a)); x: var(--c, rgb(1, 2, 3))', { '--a': 'red' }),
  ' color: red; border-color: red; x: rgb(1, 2, 3)');

// @media against the page area
assert.ok(mediaMatches('print', 500, 700) && mediaMatches('all and (min-width: 600px)', 500, 700)); // 600px = 450pt
assert.ok(!mediaMatches('screen', 500, 700) && !mediaMatches('(width > 800px)', 500, 700) && mediaMatches('not screen', 500, 700));
assert.ok(mediaMatches('screen, (orientation: portrait)', 500, 700) && !mediaMatches('(orientation: landscape)', 500, 700));

// template filters, like pdfrs
const t = (s: string, data = {}, locale = 'fr') => fillTemplate(s, data, { locale });
assert.equal(t('{{ n | money }}', { n: 1234.5 }), '1\u00a0234,50\u00a0€');
assert.equal(t("{{ n | money('USD', locale='en') }} {{ -3.456 | money('USD', locale='en') }}", { n: 1234.5 }), '$1,234.50 -$3.46');
assert.equal(t("{{ 1234.5 | money(decimals=0, locale='de') }}"), '1.235\u00a0€');
assert.equal(t("{{ 2.675 | number(2) }} {{ 0.5 | number }} {{ -0.004 | money }} {{ '12,5' | number(2) }}"), '2,68 1 0,00\u00a0€ 12,50');
assert.equal(formatNumber(1234.5, 2, 'fr-CH'), '1’234.50');
assert.equal(t("{{ s | date }} {{ s | date('%A %e %B %Y') }}", { s: '2026-10-15' }), '15/10/2026 jeudi 15 octobre 2026');
assert.equal(t("{{ '2026-10-15T08:30:00Z' | date('%d/%m %H:%M') }} {{ '2026-10-15' | date('%A %e %B %Y') }}", {}, 'en'), '15/10 08:30 Thursday 15 October 2026');
assert.throws(() => t("{{ 'hier' | date }}"), /not a date/);
assert.equal(t('{{ a | nl2br }}', { a: '1 rue <X>\n75000' }), '1 rue &lt;X&gt;<br>\n75000');
// strict and escaped
assert.equal(t('<td>{{ x }}</td>{{ y | safe }}', { x: '<b>&', y: '<i>' }), '<td>&lt;b&gt;&amp;</td><i>');
assert.throws(() => t('{{ client.nom }}', { client: {} }));
assert.throws(() => t('{{ absent | money }}'), /undefined/);
assert.equal(t("{{ nom | default('anonyme') }}{% if remise is defined %}x{% endif %}"), 'anonyme');
// {% extends %} / {% include %} inside the templates folder only
mkdirSync(join(root, 'tpl'));
writeFileSync(join(root, 'tpl', 'base.html'), '<h1>{% block title %}{% endblock %}</h1>');
writeFileSync(join(root, 'secret.html'), 'secret');
symlinkSync(join(root, 'secret.html'), join(root, 'tpl', 'link.html'));
const tpl = { templates: join(root, 'tpl') };
assert.equal(fillTemplate("{% extends 'base.html' %}{% block title %}F {{ n }}{% endblock %}", { n: 42 }, tpl), '<h1>F 42</h1>');
for (const name of ['../secret.html', 'link.html', '/etc/hosts']) assert.throws(() => fillTemplate(`{% include '${name}' %}`, {}, tpl));

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
// end to end: @page, <link>, @import, @media, var(), <title>, '400x600' sizes, CSS-order margins, template data
writeFileSync(join(root, 'site', 'a.css'), '@import "b.css"; p { color: var(--brand) }');
writeFileSync(join(root, 'site', 'b.css'), ':root { --brand: #c00 }');
const styled = await htmlToPdf(`<html><head><title>Doc {{ n }}</title><link rel="stylesheet" href="a.css">
  <style>@page { size: A5 landscape; margin: 10mm } @media screen { p { color: blue } } @media print { h1 { font-size: 20px } }</style></head>
  <body><h1>{{ n | money }}</h1><p>x</p></body></html>`, { data: { n: 3 }, images: site });
assert.match(styled.toString('latin1'), /\(Doc 3\)/);
assert.match(styled.toString('latin1'), /MediaBox \[0 0 595\.\d+ 419\.\d+\]/); // A5 landscape from @page
const sized = await htmlToPdf('<p>x</p>', { size: '400x600', margin: '60 40 50 40' });
assert.match(sized.toString('latin1'), /MediaBox \[0 0 400 600\]/);
await assert.rejects(htmlToPdf('<p>x</p>', { margin: 'auto' }), /invalid margin/);
console.log('ok');
