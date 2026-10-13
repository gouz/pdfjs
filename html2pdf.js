#!/usr/bin/env node
// Layout is done by Yoga (via @react-pdf/renderer): full flexbox, pagination, real selectable text.
// react-pdf-html turns the HTML + <style> tags into react-pdf elements.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createElement as h } from 'react';
import { Document, Page, View, Image, Font, renderToFile, renderToBuffer } from '@react-pdf/renderer';
import Html from 'react-pdf-html';
import { imageSize } from 'image-size';

// CSS display:flex defaults to row, Yoga defaults to column.
const flexRow = (style) => {
  const s = Object.assign({}, ...[style].flat());
  return s.display === 'flex' && !s.flexDirection ? [...[style].flat(), { flexDirection: 'row' }] : style;
};
const block = ({ style, children }) => h(View, { style: flexRow(style) }, children);

/**
 * Resolve an <img src> under the image policy; null = blocked.
 * HTML may be untrusted, so by default only inline data: images pass:
 *   - local files only if `baseDir` is set, and only inside it (no ../ or symlink escape)
 *   - http(s) only if `remote` is true (the PDF build will fetch whatever URL the HTML names)
 *   - any other scheme (file:, ftp:, ...) never
 * @param {string} src
 * @param {{baseDir?: string, remote?: boolean}} [images]
 */
export function imageSrc(src = '', { baseDir, remote = false } = {}) {
  if (/^data:image\//i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return remote ? src : null;
  if (!baseDir || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  try {
    const root = realpathSync(baseDir);
    const file = realpathSync(resolve(root, decodeURI(src.split(/[?#]/)[0])));
    return file.startsWith(root + sep) ? file : null;
  } catch {
    return null; // missing file or malformed src
  }
}

const px = (v) => (v && !isNaN(v) ? Number(v) : v); // width="200" -> 200, width="50%" kept as is

// Intrinsic width like a browser (react-pdf would otherwise stretch the image to the container), 1px = 1pt.
// ponytail: remote images have no intrinsic size here (not fetched before layout), give them a width.
const naturalWidth = (src) => {
  try {
    return imageSize(src.startsWith('data:') ? Buffer.from(src.split(',')[1], 'base64') : readFileSync(src)).width;
  } catch {
    return undefined; // remote URL or unknown format
  }
};

export const renderers = (images) => ({
  ...Object.fromEntries(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'form'].map((t) => [t, block])),
  img: ({ style, element: { attributes: a } }) => {
    const src = imageSrc(a.src, images);
    if (!src) return console.warn(`html2pdf: image blocked or not found: ${a.src}`), null;
    const css = Object.assign({}, ...[style].flat());
    const sized = a.width || a.height || css.width || css.height;
    // width/height attributes first, CSS wins (same as browsers); height follows the aspect ratio
    return h(Image, {
      style: [{ width: sized ? px(a.width) : naturalWidth(src), height: px(a.height), maxWidth: '100%', objectFit: 'contain' }, css],
      src,
    });
  },
});

/**
 * Register fonts usable as `font` or in CSS `font-family`.
 * @param {Record<string, string | {src: string, fontWeight?: string|number, fontStyle?: string}[]>} fonts
 *   { Inter: './Inter.ttf' } or { Inter: [{ src: './Inter.ttf' }, { src: './Inter-Bold.ttf', fontWeight: 'bold' }] }
 *   src: .ttf / .otf / .woff path or URL (not .woff2).
 */
export function registerFonts(fonts) {
  for (const [family, src] of Object.entries(fonts)) {
    const faces = typeof src === 'string' ? [{ src }] : src;
    // react-pdf throws on <i>/<em> when a family has no italic face: fall back to the upright files.
    // (missing weights are fine, react-pdf picks the nearest one)
    const italic = faces.some((f) => f.fontStyle === 'italic') ? [] : faces.map((f) => ({ ...f, fontStyle: 'italic' }));
    Font.register({ family, fonts: [...faces, ...italic] });
  }
}

/**
 * @param {string} html
 * @param {object} [o]
 * @param {string} [o.output]       write to this file (resolves when done); omitted -> resolves to a Buffer
 * @param {string|number[]} [o.size='A4']  'A4', 'A3', 'LETTER', ... or [width, height] in pt
 * @param {boolean} [o.landscape=false]
 * @param {number|{top?: number, right?: number, bottom?: number, left?: number}} [o.margin=40]  in pt
 * @param {string} [o.font='Helvetica']  default family: Helvetica, Times-Roman, Courier, or one from `fonts`
 * @param {number} [o.fontSize=12]
 * @param {object} [o.fonts]        see registerFonts()
 * @param {string} [o.header]       HTML repeated in the top margin; {page} and {pages} are replaced
 * @param {string} [o.footer]       HTML repeated in the bottom margin; {page} and {pages} are replaced
 * @param {{title?: string, author?: string, subject?: string, keywords?: string}} [o.meta]  PDF metadata
 * @param {{baseDir?: string, remote?: boolean}} [o.images]  image policy, see imageSrc(); default: data: URIs only
 */
export function htmlToPdf(html, {
  output, size = 'A4', landscape = false, margin = 40, font = 'Helvetica', fontSize = 12,
  fonts, header, footer, meta = {}, images,
} = {}) {
  if (fonts) registerFonts(fonts);
  const r = renderers(images);
  const m = typeof margin === 'number' ? { top: margin, right: margin, bottom: margin, left: margin } : { top: 40, right: 40, bottom: 40, left: 40, ...margin };
  const text = { fontFamily: font, fontSize };

  // header/footer: absolute in the page margin, re-rendered on every page for the page numbers
  const band = (content, edge) => content && h(View, {
    fixed: true,
    style: { position: 'absolute', [edge]: 0, left: m.left, right: m.right, height: m[edge], justifyContent: 'center' },
    render: ({ pageNumber, totalPages }) => h(Html, { renderers: r, style: text },
      content.replaceAll('{page}', pageNumber).replaceAll('{pages}', totalPages)),
  });

  const doc = h(Document, meta,
    h(Page, { size, orientation: landscape ? 'landscape' : 'portrait', style: { ...text, paddingTop: m.top, paddingRight: m.right, paddingBottom: m.bottom, paddingLeft: m.left } },
      band(header, 'top'),
      h(Html, { renderers: r, style: text }, html),
      band(footer, 'bottom')));
  return output ? renderToFile(doc, output) : renderToBuffer(doc);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v, positionals: [input, output = 'out.pdf'] } = parseArgs({
    allowPositionals: true,
    options: {
      size: { type: 'string' }, landscape: { type: 'boolean' }, margin: { type: 'string' },
      font: { type: 'string' }, 'font-size': { type: 'string' }, 'font-file': { type: 'string', multiple: true },
      header: { type: 'string' }, footer: { type: 'string' }, title: { type: 'string' },
      'remote-images': { type: 'boolean' },
    },
  });
  if (!input) {
    console.error(`Usage: html2pdf <input.html> [output.pdf] [options]
  --size A4|LETTER|...      --landscape            --margin 40
  --font Georgia            --font-size 12         --font-file Georgia=./Georgia.ttf (repeatable)
  --header '<p>Titre</p>'   --footer '<p>{page} / {pages}</p>'   --title 'Facture 42'
  --remote-images           also load http(s) images (local images: only from the input file's folder)`);
    process.exit(1);
  }
  await htmlToPdf(readFileSync(input, 'utf8'), {
    output, size: v.size, landscape: v.landscape, font: v.font, header: v.header, footer: v.footer,
    margin: v.margin && Number(v.margin), fontSize: v['font-size'] && Number(v['font-size']),
    fonts: v['font-file'] && Object.fromEntries(v['font-file'].map((f) => f.split(/=(.*)/s, 2))),
    meta: { title: v.title },
    images: { baseDir: dirname(resolve(input)), remote: v['remote-images'] },
  });
  console.log(`✔ ${output}`);
}
