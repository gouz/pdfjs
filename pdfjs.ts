#!/usr/bin/env node
// Layout is done by Yoga (via @react-pdf/renderer): full flexbox, pagination, real selectable text.
// react-pdf-html turns the HTML + <style> tags into react-pdf elements.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createElement as h, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Document, Page, View, Image, Font, renderToFile, renderToBuffer } from '@react-pdf/renderer';
import Html from 'react-pdf-html';
import { imageSize } from 'image-size';

type Renderers = NonNullable<ComponentProps<typeof Html>['renderers']>;
type RendererProps = Parameters<Renderers[string]>[0];
// the subset of react-pdf-html's renderer props we read (kept small so tests can pass plain objects)
type Props = { style: RendererProps['style']; children?: ReactNode; element: { attributes: Record<string, string> } };
export type Renderer = (props: Props) => ReactElement | null;
type Style = Record<string, any>;

/** Image policy, see imageSrc(). */
export interface ImageOptions {
  baseDir?: string;
  remote?: boolean;
}

/** { Inter: './Inter.ttf' } or { Inter: [{ src: './Inter.ttf' }, { src: './Inter-Bold.ttf', fontWeight: 'bold' }] } */
export type Fonts = Record<string, string | { src: string; fontWeight?: string | number; fontStyle?: string }[]>;

export interface PdfOptions {
  /** write to this file (resolves when done); omitted -> resolves to a Buffer */
  output?: string;
  /** 'A4', 'A3', 'LETTER', ... or [width, height] in pt */
  size?: ComponentProps<typeof Page>['size'];
  landscape?: boolean;
  /** in pt */
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** default family: Helvetica, Times-Roman, Courier, or one from `fonts` */
  font?: string;
  fontSize?: number;
  fonts?: Fonts;
  /** HTML repeated in the top margin; {page} and {pages} are replaced */
  header?: string;
  /** HTML repeated in the bottom margin; {page} and {pages} are replaced */
  footer?: string;
  meta?: { title?: string; author?: string; subject?: string; keywords?: string };
  /** default: data: URIs only */
  images?: ImageOptions;
}

/** Replace CSS values that crash react-pdf (e.g. border-width keywords). */
const borderWidths: Record<string, string> = { thin: '1px', medium: '3px', thick: '5px' };
export const sanitizeCss = (html: string) =>
  html.replace(
    /(border(?:-(?:top|right|bottom|left))?(?:-width)?\s*:\s*)(thin|medium|thick)\b/gi,
    (_, prop: string, kw: string) => prop + borderWidths[kw.toLowerCase()],
  );

const merge = (style: unknown): Style => Object.assign({}, ...[style].flat());

// CSS display:flex defaults to row, Yoga defaults to column.
const flexRow = (style: RendererProps['style']) =>
  merge(style).display === 'flex' && !merge(style).flexDirection ? [...style, { flexDirection: 'row' as const }] : style;
const block: Renderer = ({ style, children }) => h(View, { style: flexRow(style) }, children);

/**
 * Resolve an <img src> under the image policy; null = blocked.
 * HTML may be untrusted, so by default only inline data: images pass:
 *   - local files only if `baseDir` is set, and only inside it (no ../ or symlink escape)
 *   - http(s) only if `remote` is true (the PDF build will fetch whatever URL the HTML names)
 *   - any other scheme (file:, ftp:, ...) never
 */
export function imageSrc(src = '', { baseDir, remote = false }: ImageOptions = {}): string | null {
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

const px = (v?: string) => (v && !isNaN(Number(v)) ? Number(v) : v); // width="200" -> 200, width="50%" kept as is

// Intrinsic width like a browser (react-pdf would otherwise stretch the image to the container), 1px = 1pt.
// ponytail: remote images have no intrinsic size here (not fetched before layout), give them a width.
const naturalWidth = (src: string) => {
  try {
    return imageSize(src.startsWith('data:') ? Buffer.from(src.split(',')[1], 'base64') : readFileSync(src)).width;
  } catch {
    return undefined; // remote URL or unknown format
  }
};

export const renderers = (images?: ImageOptions): Record<string, Renderer> => ({
  ...Object.fromEntries(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'form'].map((t) => [t, block])),
  img: ({ style, element: { attributes: a } }) => {
    const src = imageSrc(a.src, images);
    if (!src) return console.warn(`pdfjs: image blocked or not found: ${a.src}`), null;
    const css = merge(style);
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
 * src: .ttf / .otf / .woff path or URL (not .woff2).
 */
export function registerFonts(fonts: Fonts) {
  for (const [family, src] of Object.entries(fonts)) {
    const faces = typeof src === 'string' ? [{ src }] : src;
    // react-pdf throws on <i>/<em> when a family has no italic face: fall back to the upright files.
    // (missing weights are fine, react-pdf picks the nearest one)
    const italic = faces.some((f) => 'fontStyle' in f && f.fontStyle === 'italic') ? [] : faces.map((f) => ({ ...f, fontStyle: 'italic' }));
    Font.register({ family, fonts: [...faces, ...italic] as any });
  }
}

export function htmlToPdf(html: string, opts: PdfOptions & { output: string }): Promise<void>;
export function htmlToPdf(html: string, opts?: PdfOptions & { output?: undefined }): Promise<Buffer>;
export function htmlToPdf(html: string, opts?: PdfOptions): Promise<Buffer | void>;
export function htmlToPdf(html: string, {
  output, size = 'A4', landscape = false, margin = 40, font = 'Helvetica', fontSize = 12,
  fonts, header, footer, meta = {}, images,
}: PdfOptions = {}): Promise<void | Buffer> {
  if (fonts) registerFonts(fonts);
  const r = renderers(images);
  const m = typeof margin === 'number' ? { top: margin, right: margin, bottom: margin, left: margin } : { top: 40, right: 40, bottom: 40, left: 40, ...margin };
  const text = { fontFamily: font, fontSize };

  // header/footer: absolute in the page margin, re-rendered on every page for the page numbers
  const band = (content: string | undefined, edge: 'top' | 'bottom') => content && h(View, {
    fixed: true,
    style: { position: 'absolute', [edge]: 0, left: m.left, right: m.right, height: m[edge], justifyContent: 'center' },
    // react-pdf passes totalPages at runtime, its View typings only declare pageNumber
    render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) => h(Html, { renderers: r, style: text,
      children: sanitizeCss(content.replaceAll('{page}', String(pageNumber)).replaceAll('{pages}', String(totalPages))) }),
  });

  const doc = h(Document, meta,
    h(Page, { size, orientation: landscape ? 'landscape' : 'portrait', style: { ...text, paddingTop: m.top, paddingRight: m.right, paddingBottom: m.bottom, paddingLeft: m.left } },
      band(header, 'top'),
      h(Html, { renderers: r, style: text, children: sanitizeCss(html) }),
      band(footer, 'bottom')));
  return output ? renderToFile(doc, output).then(() => {}) : renderToBuffer(doc);
}

// realpath: once installed, argv[1] is the node_modules/.bin/pdfjs symlink
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
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
    console.error(`Usage: pdfjs <input.html> [output.pdf] [options]
  --size A4|LETTER|...      --landscape            --margin 40
  --font Georgia            --font-size 12         --font-file Georgia=./Georgia.ttf (repeatable)
  --header '<p>Titre</p>'   --footer '<p>{page} / {pages}</p>'   --title 'Facture 42'
  --remote-images           also load http(s) images (local images: only from the input file's folder)`);
    process.exit(1);
  }
  await htmlToPdf(readFileSync(input, 'utf8'), {
    output, size: v.size as PdfOptions['size'], landscape: v.landscape, font: v.font, header: v.header, footer: v.footer,
    margin: v.margin ? Number(v.margin) : undefined, fontSize: v['font-size'] ? Number(v['font-size']) : undefined,
    fonts: v['font-file'] && Object.fromEntries(v['font-file'].map((f) => f.split(/=(.*)/s, 2))),
    meta: { title: v.title },
    images: { baseDir: dirname(resolve(input)), remote: v['remote-images'] },
  });
  console.log(`✔ ${output}`);
}
