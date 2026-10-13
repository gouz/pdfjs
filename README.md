# html2pdf

Génère des PDF depuis du HTML/CSS en Node.js, **sans navigateur** (ni Chrome ni Puppeteer).

La mise en page est faite par [Yoga](https://yogalayout.dev) via [`@react-pdf/renderer`](https://react-pdf.org) : flexbox complet, pagination automatique, texte sélectionnable. Le HTML et les balises `<style>` sont lus par [`react-pdf-html`](https://github.com/danomatic/react-pdf-html).

## Installation

```bash
npm install
```

Node.js 20 ou plus récent.

## Ligne de commande

```bash
node html2pdf.js facture.html facture.pdf
```

| Option | Exemple | |
|---|---|---|
| `--size` | `--size A5` | format de page (`A4` par défaut, `A3`, `LETTER`…) |
| `--landscape` | | orientation paysage |
| `--margin` | `--margin 30` | marges en pt (40 par défaut) |
| `--font` | `--font Georgia` | police par défaut |
| `--font-size` | `--font-size 11` | taille par défaut (12) |
| `--font-file` | `--font-file Georgia=./Georgia.ttf` | enregistre une police, répétable |
| `--header` | `--header '<p>Rapport</p>'` | en-tête répété sur chaque page |
| `--footer` | `--footer '<p>{page} / {pages}</p>'` | pied de page répété sur chaque page |
| `--title` | `--title 'Facture 42'` | titre dans les métadonnées du PDF |
| `--remote-images` | | autorise les images `http(s)` |

Les images locales sont autorisées depuis le dossier du fichier HTML (et ses sous-dossiers).

## API

```js
import { htmlToPdf } from './html2pdf.js';

// Écrit un fichier
await htmlToPdf('<h1>Bonjour</h1>', { output: 'bonjour.pdf' });

// Sans `output` : renvoie un Buffer (pour une réponse HTTP, un e-mail, un stockage…)
const pdf = await htmlToPdf(html);
```

Toutes les options :

```js
await htmlToPdf(html, {
  output: 'rapport.pdf',          // sinon : Buffer
  size: 'A4',                     // 'A3', 'LETTER'… ou [largeur, hauteur] en pt
  landscape: false,
  margin: 40,                     // ou { top: 60, right: 40, bottom: 50, left: 40 } (pt)
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
  meta: { title: 'Rapport', author: 'Moi', subject: '', keywords: '' },
  images: { baseDir: './templates', remote: false },
});
```

### Polices

- Formats : `.ttf`, `.otf`, `.woff` (pas `.woff2`), chemin local ou URL.
- Une police enregistrée est aussi utilisable en CSS : `font-family: Georgia`.
- Sans fichier gras ou italique, le texte en `<b>` / `<i>` s'affiche avec le fichier normal (pas de faux gras ni de faux italique).
- `registerFonts(fonts)` est exporté pour enregistrer les polices une fois au démarrage.

### Images

Le HTML peut venir d'une source non fiable, donc **par défaut seules les images `data:` sont chargées**.

| Source | Autorisée si… |
|---|---|
| `data:image/...` | toujours |
| `logo.png`, `img/a.jpg` | `images.baseDir` est défini, et le fichier est **dans** ce dossier (`../`, chemins absolus et liens symboliques qui en sortent sont refusés) |
| `https://...` | `images.remote: true` (attention : la génération ira chercher n'importe quelle URL écrite dans le HTML) |
| `file://`, autres | jamais |

Une image refusée ou introuvable n'est pas affichée et un avertissement est écrit dans la console.

Comme dans un navigateur, une image sans taille garde sa taille naturelle (1 px = 1 pt), sans dépasser la largeur disponible. `width` / `height` (attributs ou CSS) sont respectés, avec conservation des proportions si un seul est donné.

Formats : PNG et JPEG. Les SVG doivent être écrits directement dans le HTML (`<svg>…</svg>`), pas via `<img>`.

## CSS pris en charge

- **Flexbox** complet : `flex-direction`, `justify-content`, `align-items`, `align-self`, `flex-grow`/`flex-shrink`/`flex-basis`, `flex-wrap`, `gap`.
- Boîtes : `width`/`height` (+ `min`/`max`), `margin`, `padding`, `border`, `border-radius`, `background-color`, `position: absolute`.
- Texte : `font-family`, `font-size`, `font-weight`, `font-style`, `color`, `text-align`, `line-height`, `text-decoration`, `text-transform`, `letter-spacing`.
- Tableaux, listes, liens, `<svg>` inline.
- `<style>` avec sélecteurs simples (balise, `.classe`, `#id`, descendants).

**Non pris en charge** : CSS grid, `float`, `background-image`, pseudo-éléments (`::before`), `@media`, `@font-face` (utiliser `fonts`), feuilles de style externes `<link>`.

## Exemples

```bash
node html2pdf.js demo/example.html example.pdf   # facture simple
node html2pdf.js demo/flex.html flex.pdf         # démonstration flexbox
node html2pdf.js demo/images.html images.pdf     # images (ajouter --remote-images pour l'image distante)
```

## Tests

```bash
npm test
```
