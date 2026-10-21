# pdfjs

Génère des PDF depuis du HTML/CSS en Node.js, **sans navigateur** (ni Chrome ni Puppeteer).

La mise en page est faite par [Yoga](https://yogalayout.dev) via [`@react-pdf/renderer`](https://react-pdf.org) : flexbox complet, pagination automatique, texte sélectionnable. Le HTML et les balises `<style>` sont lus par [`react-pdf-html`](https://github.com/danomatic/react-pdf-html).

## Installation

```bash
npm install @gouz/pdfjs
```

Node.js 22.18 ou plus récent, ou Bun. Types TypeScript inclus.

## Ligne de commande

```bash
npx pdfjs facture.html facture.pdf
```

| Option | Exemple | |
|---|---|---|
| `--size` | `--size A5`, `--size 400x600` | format de page (`A4` par défaut, `A3`, `A6`, `B5`, `LETTER`…, ou `LARGEURxHAUTEUR` en pt) |
| `--landscape` | | orientation paysage |
| `--margin` | `--margin 30`, `--margin '60 40 50 40'` | marges en pt (40 par défaut), ordre CSS haut droite bas gauche |
| `--font` | `--font Georgia` | police par défaut |
| `--font-size` | `--font-size 11` | taille par défaut (12) |
| `--font-file` | `--font-file Georgia=./Georgia.ttf` | enregistre une police, répétable |
| `--header` | `--header '<p>Rapport</p>'` | en-tête répété sur chaque page |
| `--footer` | `--footer '<p>{page} / {pages}</p>'` | pied de page répété sur chaque page |
| `--title` | `--title 'Facture 42'` | titre dans les métadonnées du PDF (sinon : la balise `<title>`) |
| `--remote-images` | | autorise les images, feuilles de style et polices `http(s)` |
| `--data` | `--data facture.json` | le fichier HTML devient un [template](#templates), rempli avec ces données |
| `--locale` | `--locale en` | langue des filtres `money` / `number` / `date` (`fr` par défaut) |

Les images, feuilles de style et polices locales sont autorisées depuis le dossier du fichier HTML (et ses sous-dossiers).

`size`, `landscape` et `margin` peuvent aussi venir du document : `@page { size: A5 landscape; margin: 10mm }` (`var()` accepté). Une option passée explicitement l'emporte sur `@page`.

## API

```ts
import { htmlToPdf } from '@gouz/pdfjs';

// Écrit un fichier
await htmlToPdf('<h1>Bonjour</h1>', { output: 'bonjour.pdf' });

// Sans `output` : renvoie un Buffer (pour une réponse HTTP, un e-mail, un stockage…)
const pdf = await htmlToPdf(html);
```

Toutes les options :

```ts
await htmlToPdf(html, {
  output: 'rapport.pdf',          // sinon : Buffer
  size: 'A4',                     // 'A3', 'LETTER', '400x600'… ou [largeur, hauteur] en pt (défaut : @page, sinon A4)
  landscape: false,               // défaut : @page, sinon false
  margin: 40,                     // ou '60 40 50 40', ou { top: 60, right: 40, bottom: 50, left: 40 } (pt ; défaut : @page, sinon 40)
  font: 'Helvetica',              // Helvetica, Times-Roman, Courier, ou une police de `fonts`
  fontSize: 12,
  fonts: {
    Georgia: [
      { src: './fonts/Georgia.ttf' },
      { src: './fonts/Georgia-Bold.ttf', fontWeight: 'bold' },
      { src: './fonts/Georgia-Italic.ttf', fontStyle: 'italic' },
    ],
    Verdana: './fonts/Verdana.ttf', // un seul fichier suffit
  },
  header: '<p style="color: gray">Rapport — confidentiel</p>',
  footer: '<p style="text-align: right">Page {page} / {pages}</p>',
  meta: { title: 'Rapport', author: 'Moi', subject: '', keywords: '' }, // title : sinon la balise <title>
  images: { baseDir: './templates', remote: false },                   // images, <link>, @import, @font-face
  data: { numero: 42 },           // le HTML (et header / footer) devient un template, voir Templates
  locale: 'fr',                   // filtres money / number / date
  templates: './templates',       // dossier lu par {% extends %} / {% include %}
});
```

### Polices

- Formats : `.ttf`, `.otf`, `.woff` (pas `.woff2`), chemin local ou URL.
- Une police enregistrée est aussi utilisable en CSS : `font-family: Georgia`.
- Sans fichier gras ou italique, le texte en `<b>` / `<i>` s'affiche avec le fichier normal (pas de faux gras ni de faux italique).
- `registerFonts(fonts)` est exporté pour enregistrer les polices une fois au démarrage.
- Comme dans un navigateur, une pile `font-family: "Segoe UI", Roboto, sans-serif` prend la première police disponible : une police enregistrée, ou une police intégrée (`sans-serif`/`Arial` → Helvetica, `serif` → Times-Roman, `monospace` → Courier). Si aucune ne l'est, la déclaration est ignorée et la police par défaut s'applique.

### Templates

Avec `data`, le HTML est un template [Nunjucks](https://mozilla.github.io/nunjucks/) (syntaxe Jinja / Twig, comme les templates MiniJinja de [pdfrs](https://github.com/gouz/pdfrs)), rempli avant le rendu. `header` et `footer` aussi (`{page}` / `{pages}` restent remplacés à chaque page).

```ts
await htmlToPdf(readFileSync('templates/facture.html', 'utf8'), {
  data: { numero: '2026-0142', client: { nom: 'ACME' }, lignes: [{ libelle: 'Café', quantite: 2, prix: 3 }] },
  templates: './templates', // pour {% extends "base.html" %} / {% include "parts/adresse.html" %}
  locale: 'fr',
});
// ou seulement le texte : fillTemplate(template, data, { locale, templates })
```

```bash
npx pdfjs demo/templates/facture.html facture.pdf --data demo/templates/facture.json   # templates : le dossier du fichier
```

- **Syntaxe** : `{{ client.nom }}`, `{% for l in lignes %}…{% endfor %}`, `{% if remise is defined %}`, `{% set total = total + l.prix %}`, `loop.index`, `{# commentaires #}`, macros et les [filtres de Nunjucks](https://mozilla.github.io/nunjucks/templating.html#builtin-filters) (`default`, `length`, `round`, `sum`, `upper`, `join`, `sort`, `groupby`, `dump`…).
- **Strict** : une variable absente des données est une erreur, une faute de frappe n'imprime pas une facture vide. Champs optionnels : `{{ client.tva | default("") }}`, `{% if client.tva is defined %}`.
- **Échappé** : chaque `{{ … }}` est échappé en HTML. `| safe` le désactive, pour du HTML de confiance uniquement.
- **Borné au dossier** : `{% extends %}` / `{% include %}` ne lisent que les fichiers de `templates` (pas de `../`, chemin absolu ou lien symbolique qui en sort).
- **Pas de bac à sable** : contrairement à pdfrs, pas de limite de temps (une boucle sans fin bloque le rendu), et Nunjucks n'est pas conçu pour des templates hostiles. Les templates doivent venir d'une source de confiance ; les données, elles, peuvent être quelconques.

Filtres pour les documents commerciaux, identiques à pdfrs :

| Filtre | `fr` | `en` |
|---|---|---|
| `{{ 1234.5 \| money }}` | `1 234,50 €` | `€1,234.50` |
| `{{ 99 \| money("USD") }}` | `99,00 $` | `$99.00` |
| `{{ total \| money(decimals=0) }}` | `1 235 €` | `€1,235` |
| `{{ 1234.5 \| number }}` / `number(2)` | `1 235` / `1 234,50` | `1,235` / `1,234.50` |
| `{{ "2026-10-15" \| date }}` | `15/10/2026` | `10/15/2026` |
| `{{ "2026-10-15" \| date("%A %e %B %Y") }}` | `jeudi 15 octobre 2026` | `Thursday 15 October 2026` |
| `{{ adresse \| nl2br }}` | retours à la ligne en `<br>`, échappé | |

Montants arrondis au demi supérieur en valeur absolue (`2.675` → `2,68`), dates au format `YYYY-MM-DD` avec heure optionnelle (`2026-10-15T08:30:00Z`, `%H:%M`), `locale="…"` sur un filtre remplace celle du rendu. Locales : `fr`, `en`, `de`, `es`, `it`, `fr-CH`… (séparateurs ; noms de mois et de jours en français ou en anglais). En `fr`, le séparateur des milliers est une espace insécable (U+00A0) et pas l'espace fine de pdfrs (U+202F), que les polices intégrées n'ont pas.

### Images

Le HTML peut venir d'une source non fiable, donc **par défaut seules les images `data:` sont chargées**.

| Source | Autorisée si… |
|---|---|
| `data:image/...` | toujours |
| `logo.png`, `img/a.jpg` | `images.baseDir` est défini, et le fichier est **dans** ce dossier (`../`, chemins absolus et liens symboliques qui en sortent sont refusés) |
| `https://...` | `images.remote: true` (attention : la génération ira chercher n'importe quelle URL écrite dans le HTML) |
| `file://`, autres | jamais |

Une image refusée ou introuvable n'est pas affichée et un avertissement est écrit dans la console.

Comme dans un navigateur, une image sans taille garde sa taille naturelle (1 px = 0,75 pt), sans dépasser la largeur disponible. `width` / `height` (attributs ou CSS) sont respectés, avec conservation des proportions si un seul est donné.

Formats : PNG et JPEG. Les SVG doivent être écrits directement dans le HTML (`<svg>…</svg>`), pas via `<img>`.

## CSS pris en charge

Comme dans un navigateur, **1 px = 0,75 pt** (96 px par pouce), dans le CSS comme dans les attributs `width` / `height`. Une longueur sans unité est en pt.

- **Flexbox** complet : `flex-direction`, `justify-content`, `align-items`, `align-self`, `flex-grow`/`flex-shrink`/`flex-basis`, `flex-wrap`, `gap`.
- Boîtes : `width`/`height` (+ `min`/`max`), `margin`, `padding`, `border`, `border-radius`, `background-color`, `position: absolute`.
- Texte : `font-family`, `font-size`, `font-weight`, `font-style`, `color`, `text-align`, `line-height`, `text-decoration`, `text-transform`, `letter-spacing`.
- Tableaux, listes, liens, `<svg>` inline.
- `<style>` avec sélecteurs simples (balise, `.classe`, `#id`, descendants).
- **Variables** : `--nom: valeur` et `var(--nom, repli)`, imbriquées. Elles sont globales : la dernière déclaration l'emporte, quel que soit son sélecteur.
- **`@media`** : `print` / `all` s'appliquent, `screen` non. Sont aussi gérés `min-` / `max-width` / `-height`, la syntaxe `(width >= 600px)`, `orientation`, `not` et les listes, tous évalués sur la zone imprimable de la page. Même règle pour `<style media="…">` et `<link media="…">`. `@supports` et `@layer` sont toujours appliqués.
- **`@page`** : `size` (`A5`, `A4 landscape`, `210mm 297mm`) et `margin`. `:first`, `:left` / `:right` et les boîtes de marge sont ignorés : utiliser `header` / `footer`.
- **Feuilles externes** : `<link rel="stylesheet" href="…">` et `@import`, avec la même règle que les images (`images.baseDir`, ou `images.remote`). Les `url()` d'une feuille importée sont résolues depuis `baseDir`.
- **`@font-face`** : `font-family`, `src` (`data:`, fichier local ou URL suivant la même règle ; le premier `src` qui n'est pas en `.woff2`), `font-weight`, `font-style`. La police est enregistrée globalement, comme avec `fonts`.

**Non pris en charge** : CSS grid, `float`, `background-image`, pseudo-éléments (`::before`), `calc()`, compteurs, boîtes de marge `@page`. Pour tout ça, voir [pdfrs](https://github.com/gouz/pdfrs).

**À savoir** :
- Un texte qui déborde d'une hauteur fixe (`height`) n'est pas affiché, ou est tronqué avec `…`, alors qu'un navigateur le laisse dépasser. Préférer `min-height`.
- Un `min-height` plus grand que la page est ramené à la hauteur de la page (sinon le rendu ne se termine jamais).

## Exemples

| Source | Rendu | |
|---|---|---|
| [`demo/example.html`](demo/example.html) | [`demo/example.pdf`](demo/example.pdf) | facture simple |
| [`demo/flex.html`](demo/flex.html) | [`demo/flex.pdf`](demo/flex.pdf) | flexbox |
| [`demo/images.html`](demo/images.html) | [`demo/images.pdf`](demo/images.pdf) | images (l'image distante est bloquée par défaut, ajouter `--remote-images`) |
| [`demo/features.html`](demo/features.html) + [`print.css`](demo/print.css) | [`demo/features.pdf`](demo/features.pdf) | `<link>`, `@import`, `var()`, `@media print`, `@page` A5 |
| [`demo/templates/facture.html`](demo/templates/facture.html) + [`.json`](demo/templates/facture.json) | [`demo/facture.pdf`](demo/facture.pdf) | template : boucle, total, filtres `money` / `number` / `date` / `nl2br` |

Pour régénérer les rendus :

```bash
npm run demo
node pdfjs.ts demo/templates/facture.html demo/facture.pdf --data demo/templates/facture.json
```

## Performances

Mesuré avec [k6](https://k6.io) via un petit serveur HTTP (`bench/server.ts` : POST du HTML, réponse en PDF), sur les trois documents de `demo/` en alternance. Machine : Apple Silicon 8 cœurs (6 performance + 2 efficacité), Node 26.11, Bun 1.4, k6 sur la même machine. `NODE_ENV=production`, Node lancé avec `--max-old-space-size=128`. Chaque palier dure 15 s ; la mémoire est le pic de RSS du serveur (tous ses process) pendant le palier.

![Débit selon le nombre d'utilisateurs simultanés : Node × 8 monte à ~1 050 PDF/s, les autres configurations plafonnent entre 250 et 330 PDF/s](bench/chart.svg)

![Mémoire max selon le nombre d'utilisateurs simultanés : de ~240 Mo (Node × 1 au repos) à ~2,1 Go (Node × 8 à 200 VUs)](bench/memory.svg)

| Runtime × workers | Débit max | p95 à 10 VUs | p95 à 200 VUs | Mémoire à 1 VU | Mémoire à 200 VUs | Erreurs |
|---|---|---|---|---|---|---|
| Node × 1 | 251 PDF/s | 52 ms | 1 369 ms | 239 Mo | 290 Mo | 0 % |
| Node × 8 | 1 054 PDF/s | 24 ms | 329 ms | 1 255 Mo | 2 082 Mo | 0 % |
| Bun × 1 | 327 PDF/s | 42 ms | 805 ms | 322 Mo | 633 Mo | 0 % |
| Bun × 8 | 322 PDF/s | 43 ms | 832 ms | 1 064 Mo | 1 320 Mo | 0 % |

- Le rendu est **CPU-bound** : un seul process plafonne quelle que soit la charge, au-delà seule la latence monte.
- **Les rendus passent un par un** (file d'attente interne) : en parallèle ils n'iraient pas plus vite et garderaient chacun leur document en mémoire. Les requêtes en surplus attendent leur tour, d'où la latence qui monte.
- **Lancer avec `NODE_ENV=production`** : sans, React tourne en mode développement, plus lent et plus gourmand.
- **Limiter le tas de Node avec `--max-old-space-size=128`** (ou `NODE_OPTIONS=--max-old-space-size=128`) : un rendu n'utilise qu'~40 Mo de tas, mais sans limite V8 le laisse grossir à ~150 Mo avant de nettoyer. Gain : −30 à −40 % de mémoire, pour 7 à 30 % de débit en moins selon la charge. Monter la valeur (256…) pour de gros documents : au-delà de la limite, le process s'arrête (`heap out of memory`). Sans effet sur Bun (`--smol` non plus).
- **Bun est plus rapide que Node sur un process** (~10 % à réglages égaux, ~30 % face à Node bridé à 128 Mo), mais consomme deux fois plus de mémoire à 200 VUs (633 Mo contre 290 Mo).
- **Le mode cluster ne sert qu'avec Node sur macOS** : Bun lance bien les 8 workers mais ne répartit les connexions entre eux que sous Linux, donc Bun × 8 n'apporte rien ici. À re-mesurer sur Linux.
- Node × 8 multiplie le débit par ~4,2, pour ~260 Mo par worker sous forte charge.
- Coût par document : ~11 ms pour `example` et `flex`, ~77 ms pour `images` (PNG à lire et décoder).

Pour reproduire :

```bash
brew install k6
WORKERS=8 PORT=3456 npm run bench:server         # serveur seul (Node ; `bun bench/server.ts` pour Bun)
k6 run -e URL=http://localhost:3456 bench/k6.ts  # montée à 10 VUs, latence par document
npm run bench:sweep                              # balayage 1 → 200 VUs, Node et Bun, 1 worker et 1 par cœur
                                                 # → bench/results.csv, bench/chart.svg, bench/memory.svg
```

## Développement

```bash
npm install
node pdfjs.ts demo/flex.html flex.pdf   # Node et Bun exécutent le TypeScript directement
npm test
npm run typecheck   # tsc, vérification des types
npm run build       # tsc → dist/ (JS + .d.ts), lancé automatiquement par npm pack / npm publish
npm publish         # vérifie les types et les tests, build, puis publie @gouz/pdfjs
```

## Licence

[MIT](LICENSE)
