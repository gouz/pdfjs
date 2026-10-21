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
import nunjucks from 'nunjucks';

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
  /** 'A4', 'A3', 'LETTER', '400x600', ... or [width, height] in pt; default: @page size, else A4 */
  size?: ComponentProps<typeof Page>['size'] | `${number}x${number}`;
  /** default: @page size, else false */
  landscape?: boolean;
  /** in pt, or CSS order '60 40 50 40'; default: @page margin, else 40 */
  margin?: number | string | { top?: number; right?: number; bottom?: number; left?: number };
  /** default family: Helvetica, Times-Roman, Courier, or one from `fonts` */
  font?: string;
  fontSize?: number;
  fonts?: Fonts;
  /** HTML repeated in the top margin; {page} and {pages} are replaced */
  header?: string;
  /** HTML repeated in the bottom margin; {page} and {pages} are replaced */
  footer?: string;
  meta?: { title?: string; author?: string; subject?: string; keywords?: string };
  /** images, <link> / @import stylesheets and @font-face files; default: data: URIs only */
  images?: ImageOptions;
  /** fill html, header and footer as Nunjucks templates with this data first */
  data?: Record<string, unknown>;
  /** locale of the money / number / date template filters: 'fr' (default), 'en', 'de'... */
  locale?: string;
  /** folder read by {% extends %} / {% include %} */
  templates?: string;
}

const PX = 0.75; // 1px = 0.75pt, like a browser (96 px per inch)
const ptPer: Record<string, number> = { pt: 1, px: PX, mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pc: 12 };
/** CSS length -> pt (unitless = pt), NaN if it is not one */
const toPt = (v: string) => {
  const m = /^(-?\d*\.?\d+)(pt|px|mm|cm|in|pc)?$/i.exec(v.trim());
  return m ? parseFloat(m[1]) * ptPer[(m[2] ?? 'pt').toLowerCase()] : NaN;
};

// CSS generic / common families -> react-pdf's built-in fonts
const fontAliases: Record<string, string> = {
  'sans-serif': 'Helvetica', 'system-ui': 'Helvetica', '-apple-system': 'Helvetica', arial: 'Helvetica', helvetica: 'Helvetica',
  serif: 'Times-Roman', times: 'Times-Roman', 'times new roman': 'Times-Roman',
  monospace: 'Courier', courier: 'Courier', 'courier new': 'Courier',
};
// first family of the stack react-pdf can draw (it throws on an unregistered one, browsers fall through)
const usableFont = (stack: string) => {
  const registered = new Map(Font.getRegisteredFontFamilies().map((f) => [f.toLowerCase(), f]));
  for (const name of stack.replaceAll('&quot;', '').split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()))
    if (registered.has(name) || name in fontAliases) return registered.get(name) ?? fontAliases[name];
};

/**
 * Rewrite CSS that react-pdf crashes on:
 *   - border-width keywords -> px
 *   - font-family stacks -> first usable family, dropped if none (inherits the default)
 *   - `normal` gaps / spacings -> dropped (their default)
 *   - px -> pt, 1px = 0.75pt like a browser (react-pdf reads 1px as 1pt)
 */
const borderWidths: Record<string, string> = { thin: '1px', medium: '3px', thick: '5px' };
export const sanitizeCss = (css: string) =>
  css
    .replace(
      /(border(?:-(?:top|right|bottom|left))?(?:-width)?\s*:\s*)(thin|medium|thick)\b/gi,
      (_, prop: string, kw: string) => prop + borderWidths[kw.toLowerCase()],
    )
    .replace(/font-family\s*:\s*((?:&quot;|[^;}])+);?/gi, (_, stack: string) => {
      const font = usableFont(stack);
      return font ? `font-family: ${font};` : '';
    })
    .replace(/(?<![-\w])(?:gap|row-gap|column-gap|letter-spacing|word-spacing)\s*:\s*normal\s*(?:!important\s*)?;?/gi, '')
    .replace(/(?<![\w.-])(-?\d*\.?\d+)px\b/gi, (_, n: string) => `${+(Number(n) * PX).toFixed(3)}pt`);

// var(--x, fallback) -> value (nested ones too), then the --x declarations are dropped
const varRef = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;
export const substituteVars = (css: string, vars: Record<string, string>) => {
  for (let i = 0; i < 10 && css.includes('var('); i++) css = css.replace(varRef, (_, name: string, fallback = '') => vars[name] ?? fallback.trim());
  return css.replace(/(?<![\w-])--[\w-]+\s*:[^;}]*;?/g, '');
};
// ponytail: custom properties are global (last declaration wins), not scoped to their selector
const collectVars = (css: string) =>
  Object.fromEntries([...css.matchAll(/(?<![\w-])(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));

const styleBlock = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
const styles = (html: string) => [...html.matchAll(styleBlock)].map((m) => m[2]).join('\n');

// sanitizeCss on style="" attributes and <style> blocks only, text content stays untouched
const sanitizeHtml = (html: string, vars: Record<string, string> = {}) =>
  html
    .replace(styleBlock, (_, open: string, css: string, close: string) => open + sanitizeCss(substituteVars(css, vars)) + close)
    .replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (_, attr: string, q: string, css: string) => attr + q + sanitizeCss(substituteVars(css, vars)) + q);

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m && (m[1] ?? m[2] ?? m[3]);
};
const replaceAsync = async (s: string, re: RegExp, fn: (...m: string[]) => Promise<string>) => {
  const parts = await Promise.all([...s.matchAll(re)].map((m) => fn(...m)));
  let i = 0;
  return s.replace(re, () => parts[i++]);
};

/** `@name prelude { body }` blocks (nested braces included) replaced by fn(prelude, body) */
const eachAtRule = (css: string, name: string, fn: (prelude: string, body: string) => string) => {
  const re = new RegExp(`@(?:${name})\\b([^{;]*)\\{`, 'gi');
  let out = '', i = 0, m;
  while ((m = re.exec(css))) {
    let depth = 1, j = re.lastIndex;
    for (; j < css.length && depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
    out += css.slice(i, m.index) + fn(m[1].trim(), css.slice(re.lastIndex, j - 1));
    i = re.lastIndex = j;
  }
  return out + css.slice(i);
};
/** top-level `prop: value` of a block (nested blocks skipped, url() / quotes may hold `;`) */
const decls = (body: string): Record<string, string> => Object.fromEntries(
  [...body.replace(/\{[^}]*\}/g, '').matchAll(/([\w-]+)\s*:\s*((?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;])+)/g)].map((m) => [m[1].toLowerCase(), m[2].trim()]));

/** @media query against the page area (w × h pt): print / all match, screen does not */
export const mediaMatches = (query: string, w: number, h: number) => query.split(',').some((q) => {
  const [, not, rest] = /^\s*(not\s+)?(?:only\s+)?([\s\S]*)$/.exec(q.toLowerCase())!;
  const ok = rest.split(/\s+and\s+/).every((part) => {
    let m;
    if ((m = /^\(\s*(min-|max-)?(width|height)\s*:\s*([^)]+)\)$/.exec(part.trim()))) {
      const v = m[2] === 'width' ? w : h, x = toPt(m[3]);
      return m[1] === 'min-' ? v >= x : m[1] === 'max-' ? v <= x : v === x;
    }
    if ((m = /^\(\s*(width|height)\s*(>=|<=|>|<)\s*([^)]+)\)$/.exec(part.trim()))) {
      const v = m[1] === 'width' ? w : h, x = toPt(m[3]);
      return { '>=': v >= x, '<=': v <= x, '>': v > x, '<': v < x }[m[2]];
    }
    if ((m = /^\(\s*orientation\s*:\s*(\w+)\s*\)$/.exec(part.trim()))) return m[1] === (w > h ? 'landscape' : 'portrait');
    return ['all', 'print', ''].includes(part.trim());
  });
  return ok !== !!not;
});
/** @media kept if it matches, @supports / @layer unwrapped, other at-rules dropped (@page / @font-face are read before) */
const flatten = (css: string, w: number, h: number): string => {
  css = eachAtRule(css, 'media', (q, body) => (mediaMatches(q, w, h) ? flatten(body, w, h) : ''));
  css = eachAtRule(css, 'supports|layer', (_, body) => flatten(body, w, h));
  return eachAtRule(css, '[\\w-]+', () => '').replace(/@[\w-]+[^{};]*;/g, '');
};
const flattenStyles = (html: string, w: number, h: number) => html.replace(styleBlock, (_, open: string, css: string, close: string) => {
  const media = attr(open, 'media');
  return open + (media && !mediaMatches(media, w, h) ? '' : flatten(css, w, h)) + close;
});

/** a stylesheet under the image policy (local files inside baseDir, http(s) if remote); '' if blocked */
const fetchCss = async (href: string, images?: ImageOptions) => {
  const src = imageSrc(href, images);
  try {
    if (src) return /^https?:/i.test(src) ? await (await fetch(src)).text() : readFileSync(src, 'utf8');
  } catch {}
  return console.warn(`pdfjs: stylesheet blocked or not found: ${href}`), '';
};
// ponytail: url() in an imported sheet resolves against baseDir, not against the sheet
const inlineImports = async (css: string, images?: ImageOptions, depth = 0): Promise<string> =>
  replaceAsync(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi, async (_, href, media) => {
    const sheet = depth < 5 ? await inlineImports(await fetchCss(href, images), images, depth + 1) : '';
    return media.trim() ? `@media ${media} {${sheet}}` : sheet;
  });
/** <link rel="stylesheet"> -> <style>, @import inlined, comments dropped */
const inlineStylesheets = async (html: string, images?: ImageOptions) => {
  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    if (!/\bstylesheet\b/i.test(attr(tag, 'rel') ?? '')) return tag;
    const media = attr(tag, 'media');
    return `<style${media ? ` media="${media}"` : ''}>${await fetchCss(attr(tag, 'href') ?? '', images)}</style>`;
  });
  return replaceAsync(html, styleBlock, async (_, open, css, close) => open + (await inlineImports(css, images)) + close);
};

/** @font-face rules -> registerFonts (first source that is not .woff2) */
const fontFaces = (css: string, images?: ImageOptions) => {
  const faces: Record<string, { src: string; fontWeight?: string; fontStyle?: string }[]> = {};
  eachAtRule(css, 'font-face', (_, body) => {
    const d = decls(body);
    const family = d['font-family']?.replace(/^['"]|['"]$/g, '');
    const url = [...(d.src ?? '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*(?:format\(\s*['"]?([\w-]+))?/g)]
      .find(([, u, format]) => format !== 'woff2' && !/^data:font\/woff2|\.woff2(?:[?#]|$)/i.test(u))?.[1];
    const src = url && (/^data:/i.test(url) ? url : imageSrc(url, images));
    if (!family || !src) return console.warn(`pdfjs: @font-face ignored: ${family ?? ''} ${url ?? 'no usable src'}`), '';
    (faces[family] ??= []).push({ src, ...(d['font-weight'] && { fontWeight: d['font-weight'] }), ...(d['font-style'] && { fontStyle: d['font-style'] }) });
    return '';
  });
  registerFonts(faces);
};

type Margins = { top: number; right: number; bottom: number; left: number };
/** 40, { top: 60 }, '60 40 50 40', '10mm 1cm' -> pt per side; undefined if invalid */
const margins = (v: PdfOptions['margin'] | Margins): Margins | undefined => {
  if (typeof v === 'number') return { top: v, right: v, bottom: v, left: v };
  if (typeof v === 'object') return { top: 40, right: 40, bottom: 40, left: 40, ...v };
  const [top, right = top, bottom = top, left = right] = String(v).split(/[\s,]+/).filter(Boolean).map(toPt);
  return [top, right, bottom, left].every((n) => n >= 0) ? { top, right, bottom, left } : undefined;
};
/** @page { size; margin } (the first page's ones; :first, :left, margin boxes... ignored) */
const pageRule = (css: string) => {
  const page: { size?: string | [number, number]; landscape?: boolean; margin?: Margins } = {};
  eachAtRule(css, 'page', (prelude, body) => {
    if (prelude) return '';
    const d = decls(body);
    if (d.margin) page.margin = margins(d.margin) ?? page.margin;
    const words = (d.size ?? '').toLowerCase().split(/\s+/).filter((w) => w && w !== 'auto');
    if (words.includes('landscape') || words.includes('portrait')) page.landscape = words.includes('landscape');
    const dims = words.filter((w) => w !== 'landscape' && w !== 'portrait');
    const pts = dims.map(toPt);
    if (dims.length) page.size = pts.every((n) => n > 0) ? [pts[0], pts[1] ?? pts[0]] : dims[0].toUpperCase();
    return '';
  });
  return page;
};

const merge = (style: unknown): Style => Object.assign({}, ...[style].flat());

// CSS display:flex defaults to row, Yoga defaults to column.
const flexRow = (style: RendererProps['style']) =>
  merge(style).display === 'flex' && !merge(style).flexDirection ? [...style, { flexDirection: 'row' as const }] : style;
// react-pdf loops forever on a min-height taller than the page content area (it can never place it), cap it there.
// ponytail: only px/pt values are capped, em/vh/... pass through
const capMinHeight = (style: RendererProps['style'], pageHeight: number) => {
  const minHeight = merge(style).minHeight;
  const pt = typeof minHeight === 'number' ? minHeight : /^[\d.]+(px|pt)?$/.test(String(minHeight)) ? parseFloat(minHeight) : NaN;
  return pt > pageHeight ? [...style, { minHeight: pageHeight }] : style;
};
const block = (pageHeight = Infinity): Renderer => ({ style, children }) =>
  h(View, { style: flexRow(capMinHeight(style, pageHeight)) }, children);

// react-pdf's named sizes, in pt
const pageSizes: Record<string, [number, number]> = {
  A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], A6: [297.64, 419.53], B5: [498.9, 708.66],
  LETTER: [612, 792], LEGAL: [612, 1008], TABLOID: [792, 1224],
};

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

const px = (v?: string) => (v && !isNaN(Number(v)) ? Number(v) * PX : v); // width="200" -> 150 (pt), width="50%" kept as is

// Intrinsic width like a browser (react-pdf would otherwise stretch the image to the container), 1px = 0.75pt.
// ponytail: remote images have no intrinsic size here (not fetched before layout), give them a width.
const naturalWidth = (src: string) => {
  try {
    return imageSize(src.startsWith('data:') ? Buffer.from(src.split(',')[1], 'base64') : readFileSync(src)).width * PX;
  } catch {
    return undefined; // remote URL or unknown format
  }
};

/** pageHeight: height of the page content area in pt, min-heights above it are capped */
export const renderers = (images?: ImageOptions, pageHeight?: number): Record<string, Renderer> => ({
  ...Object.fromEntries(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'form'].map((t) => [t, block(pageHeight)])),
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

// ---- templates: Nunjucks (Jinja syntax), strict, escaped, with filters for business documents ----

type Filter = (this: { ctx: { _locale?: string } }, value: unknown, ...args: any[]) => unknown;
// nunjucks passes keyword arguments as a last object flagged __keywords
const kwargs = (args: any[]): Record<string, any> => (args.at(-1)?.__keywords ? args.pop() : {});
const lang = (locale: string) => locale.split(/[-_]/)[0].toLowerCase();
const defined = (v: unknown) => {
  if (v === undefined) throw new Error('undefined value (missing from the data? use `| default(...)` for optional fields)');
  return v;
};
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(defined(v));
  if (Number.isNaN(n)) throw new Error(`not a number: ${JSON.stringify(v)}`);
  return n;
};

/** digits grouped the locale's way: fr `1 234,50`, de `1.234,50`, en `1,234.50`, fr-CH `1’234.50` */
export function formatNumber(n: number, decimals: number, locale = 'fr') {
  const l = lang(locale);
  const [group, point] = ['en', 'ja', 'zh', 'ko'].includes(l) ? [',', '.'] : ['de', 'es', 'it', 'nl', 'pt', 'da', 'id'].includes(l) ? ['.', ',']
    : /ch$/i.test(locale) ? ['’', '.'] : ['\u00a0', ','];
  // half away from zero (2.5 -> 3, 2.675 -> 2.68), not to even: what an invoice expects
  const f = 10 ** Math.min(decimals, 12);
  const [int, frac] = (Math.round(Math.abs(n) * f * (1 + 1e-12)) / f).toFixed(decimals).split('.');
  const sign = n < 0 && /[1-9]/.test(int + (frac ?? '')) ? '-' : '';
  return sign + int.replace(/\B(?=(\d{3})+$)/g, group) + (frac ? point + frac : '');
}

const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF', CAD: '$ CA' };
const names = {
  fr: { months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    days: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] },
  en: { months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
};
const filters: Record<string, Filter> = {
  /** `{{ total | money }}` -> `1 234,50 €`; money('USD'), money(decimals=0), money(locale='en') */
  money(value, ...args) {
    const kw = kwargs(args), loc = kw.locale ?? this.ctx._locale ?? 'fr';
    const code = String(args[0] ?? 'EUR').toUpperCase(), symbol = symbols[code] ?? code;
    const amount = formatNumber(num(value), kw.decimals ?? (code === 'JPY' ? 0 : 2), loc);
    return lang(loc) === 'en' ? amount.replace(/^-?/, (sign) => sign + symbol) : `${amount}\u00a0${symbol}`;
  },
  /** `{{ qty | number }}` -> `1 234`; number(2) -> `1 234,50` */
  number(value, ...args) {
    const kw = kwargs(args);
    return formatNumber(num(value), args[0] ?? 0, kw.locale ?? this.ctx._locale ?? 'fr');
  },
  /** `{{ "2026-10-15" | date }}` -> `15/10/2026`; date('%A %e %B %Y') -> `jeudi 15 octobre 2026`. %d %e %m %B %b %Y %y %A %H %M */
  date(value, ...args) {
    const kw = kwargs(args), en = lang(kw.locale ?? this.ctx._locale ?? 'fr') === 'en';
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(defined(value)));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) throw new Error(`not a date (YYYY-MM-DD expected): ${JSON.stringify(value)}`);
    const [, Y, Mo, D, H = '00', Mi = '00'] = m, { months, days } = en ? names.en : names.fr;
    const parts: Record<string, string> = {
      d: D, e: String(+D), m: Mo, B: months[+Mo - 1], b: months[+Mo - 1].slice(0, 3), Y, y: Y.slice(2),
      A: days[new Date(Date.UTC(+Y, +Mo - 1, +D)).getUTCDay()], H, M: Mi, '%': '%',
    };
    return String(args[0] ?? (en ? '%m/%d/%Y' : '%d/%m/%Y')).replace(/%(.)/g, (all, c: string) => parts[c] ?? all);
  },
  /** `{{ address | nl2br }}`: escaped text, line breaks as <br> */
  nl2br: (value) => new nunjucks.runtime.SafeString(String(defined(value))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '<br>\n')),
};

/**
 * Fill a Nunjucks template (Jinja syntax) with `data`.
 * Strict: a variable missing from the data throws. Every {{ }} is HTML-escaped (`| safe` opts out).
 * {% extends %} / {% include %} read files of `templates` only (no ../, absolute path or symlink out of it).
 * ponytail: no run-time budget, an endless template loop hangs the caller; templates must come from a trusted source.
 */
export function fillTemplate(template: string, data: Record<string, unknown>, { locale = 'fr', templates }: { locale?: string; templates?: string } = {}) {
  const loader = templates && {
    getSource(name: string) {
      const path = imageSrc(name, { baseDir: templates });
      return path && { src: readFileSync(path, 'utf8'), path, noCache: true };
    },
  };
  const env = new nunjucks.Environment((loader || null) as any, { autoescape: true, throwOnUndefined: true });
  for (const [name, f] of Object.entries(filters)) env.addFilter(name, f);
  return env.renderString(template, { ...data, _locale: locale });
}

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
export async function htmlToPdf(html: string, {
  output, size, landscape, margin, font = 'Helvetica', fontSize = 12,
  fonts, header, footer, meta = {}, images, data, locale = 'fr', templates,
}: PdfOptions = {}): Promise<void | Buffer> {
  if (fonts) registerFonts(fonts);
  // react-pdf-html prints the doctype as text
  let docs = [html, header, footer].map((t) => t?.replace(/<!doctype[^>]*>/i, ''));
  if (data) docs = docs.map((t) => t && fillTemplate(t, data, { locale, templates }));
  docs = await Promise.all(docs.map((t) => t && inlineStylesheets(t, images)));
  const css = substituteVars(docs.map((t) => t && styles(t)).join('\n'), collectVars(docs.map((t) => t && styles(t)).join('\n')));
  fontFaces(css, images);

  // an option wins over @page
  const page = pageRule(css);
  const m = margins(margin ?? page.margin ?? 40);
  if (!m) throw new Error(`pdfjs: invalid margin: ${margin}`);
  const s = typeof size === 'string' && /^[\d.]+x[\d.]+$/i.test(size) ? size.split(/x/i).map(Number) as [number, number] : size ?? page.size ?? 'A4';
  const turned = landscape ?? page.landscape ?? false;
  // same lookup as react-pdf: landscape flips the size; unknown sizes stay unknown (NaN)
  const [w, ht] = typeof s === 'string' ? pageSizes[s.toUpperCase()] ?? [NaN, NaN] : typeof s === 'number' ? [s, s]
    : Array.isArray(s) ? s.map(Number) : [s.width, s.height].map(Number);
  const [areaW, areaH] = turned ? [ht - m.left - m.right, w - m.top - m.bottom] : [w - m.left - m.right, ht - m.top - m.bottom];

  docs = docs.map((t) => t && flattenStyles(t, areaW, areaH));
  const vars = collectVars(docs.map((t) => t && styles(t)).join('\n'));
  const [body, top, bottom] = docs.map((t) => t && sanitizeHtml(t, vars));
  const r = renderers(images, Number.isNaN(areaH) ? undefined : areaH);
  const text = { fontFamily: font, fontSize };
  // react-pdf-html styles <body> in Times-Roman, the `font` option wins (a <style> still wins over both)
  const sheet = { body: { fontFamily: font } };

  // header/footer: absolute in the page margin, re-rendered on every page for the page numbers
  const band = (content: string | undefined, edge: 'top' | 'bottom') => content && h(View, {
    fixed: true,
    style: { position: 'absolute', [edge]: 0, left: m.left, right: m.right, height: m[edge], justifyContent: 'center' },
    // react-pdf passes totalPages at runtime, its View typings only declare pageNumber
    render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) => h(Html, { renderers: r, style: text, stylesheet: sheet,
      children: content.replaceAll('{page}', String(pageNumber)).replaceAll('{pages}', String(totalPages)) }),
  });

  const title = meta.title ?? /<title[^>]*>([^<]*)<\/title>/i.exec(body!)?.[1].trim();
  const doc = h(Document, { ...meta, title },
    h(Page, { size: s as ComponentProps<typeof Page>['size'], orientation: turned ? 'landscape' : 'portrait', style: { ...text, paddingTop: m.top, paddingRight: m.right, paddingBottom: m.bottom, paddingLeft: m.left } },
      band(top, 'top'),
      h(Html, { renderers: r, style: text, stylesheet: sheet, children: body! }),
      band(bottom, 'bottom')));
  // One render at a time: rendering is CPU-bound, so interleaving N renders only keeps N documents in memory.
  // ponytail: a render that never settles (hung remote image) blocks the queue, add a timeout if that bites.
  const result: Promise<void | Buffer> = queue.then(() => (output ? renderToFile(doc, output).then(() => {}) : renderToBuffer(doc)));
  queue = result.catch(() => {});
  return result;
}
let queue: Promise<unknown> = Promise.resolve();

// realpath: once installed, argv[1] is the node_modules/.bin/pdfjs symlink
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const { values: v, positionals: [input, output = 'out.pdf'] } = parseArgs({
    allowPositionals: true,
    options: {
      size: { type: 'string' }, landscape: { type: 'boolean' }, margin: { type: 'string' },
      font: { type: 'string' }, 'font-size': { type: 'string' }, 'font-file': { type: 'string', multiple: true },
      header: { type: 'string' }, footer: { type: 'string' }, title: { type: 'string' },
      'remote-images': { type: 'boolean' }, data: { type: 'string' }, locale: { type: 'string' },
    },
  });
  if (!input) {
    console.error(`Usage: pdfjs <input.html> [output.pdf] [options]
  --size A4|LETTER|...      --landscape            --margin 40
  --font Georgia            --font-size 12         --font-file Georgia=./Georgia.ttf (repeatable)
  --header '<p>Titre</p>'   --footer '<p>{page} / {pages}</p>'   --title 'Facture 42'
  --remote-images           also load http(s) images, stylesheets and fonts (local ones: only from the input file's folder)
  --data facture.json       the input is a template of its folder, filled with this data   --locale fr|en|de|...`);
    process.exit(1);
  }
  await htmlToPdf(readFileSync(input, 'utf8'), {
    output, size: v.size as PdfOptions['size'], landscape: v.landscape, font: v.font, header: v.header, footer: v.footer,
    margin: v.margin, fontSize: v['font-size'] ? Number(v['font-size']) : undefined,
    fonts: v['font-file'] && Object.fromEntries(v['font-file'].map((f) => f.split(/=(.*)/s, 2))),
    meta: { title: v.title },
    images: { baseDir: dirname(resolve(input)), remote: v['remote-images'] },
    data: v.data ? JSON.parse(readFileSync(v.data, 'utf8')) : undefined, locale: v.locale, templates: dirname(resolve(input)),
  });
  console.log(`✔ ${output}`);
}
