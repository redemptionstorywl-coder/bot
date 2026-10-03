import { z } from 'zod';
import { buttonSpecSchema, embedFieldSchema, embedSpecSchema, type ButtonSpec, type EmbedSpec } from '../../src/services/EmbedService';
import { checkbox } from './validate';

/**
 * Formulaire d'édition d'embed (partial views/partials/embed-editor.ejs).
 * Les champs sont nommés `<prefix>[title]`, `<prefix>[fieldsJson]`… ; les listes dynamiques (champs, boutons)
 * sont sérialisées en JSON par public/js/repeater.js dans des champs cachés.
 */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const urlField = z.preprocess(blank, z.string().trim().url('URL invalide').max(2048).optional());

/** Chaîne JSON (ou valeur déjà parsée) → tableau ; vide → []. */
export const jsonArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === '') return [];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try {
          const parsed: unknown = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return 'invalid-json';
        }
      }
      return v;
    },
    z.array(item).max(max),
  );

/** Bouton saisi dans l'éditeur : les valeurs vides sont retirées avant validation. */
const buttonInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const b = v as Record<string, unknown>;
  const out: Record<string, unknown> = { label: typeof b.label === 'string' ? b.label.trim() : b.label, style: b.style || 'secondary' };
  if (typeof b.url === 'string' && b.url.trim()) out.url = b.url.trim();
  if (typeof b.customId === 'string' && b.customId.trim()) out.customId = b.customId.trim();
  if (typeof b.emoji === 'string' && b.emoji.trim()) out.emoji = b.emoji.trim();
  if (b.disabled === true || b.disabled === 'true' || b.disabled === 'on') out.disabled = true;
  if (out.style === 'link') delete out.customId;
  else delete out.url;
  return out;
}, buttonSpecSchema);

export const buttonsJsonSchema = jsonArray(buttonInput, 25);

const fieldInput = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const f = v as Record<string, unknown>;
  return { name: typeof f.name === 'string' ? f.name.trim() : f.name, value: typeof f.value === 'string' ? f.value.trim() : f.value, inline: f.inline === true || f.inline === 'true' || f.inline === 'on' };
}, embedFieldSchema);

export const embedFormSchema = z.object({
  title: text(256),
  url: urlField,
  description: text(4096),
  color: z.preprocess(blank, z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'couleur hexadécimale attendue').optional()),
  image: urlField,
  thumbnail: urlField,
  footerText: text(2048),
  footerIconUrl: urlField,
  authorName: text(256),
  authorIconUrl: urlField,
  authorUrl: urlField,
  timestamp: checkbox.optional(),
  fieldsJson: jsonArray(fieldInput, 25).optional(),
});
export type EmbedForm = z.infer<typeof embedFormSchema>;

/** Formulaire optionnel : `undefined` quand la section n'est pas présente dans le POST. */
export const embedFormOptional = z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined), embedFormSchema.optional());

/** Convertit le formulaire en EmbedSpec (sans clés vides). Retourne `null` si l'embed est entièrement vide. */
export function toEmbedSpec(form: EmbedForm | undefined): EmbedSpec | null {
  if (!form) return null;
  const spec: EmbedSpec = {};
  if (form.title) spec.title = form.title;
  if (form.url) spec.url = form.url;
  if (form.description) spec.description = form.description;
  if (form.color) spec.color = form.color.startsWith('#') ? form.color.toUpperCase() : `#${form.color.toUpperCase()}`;
  if (form.image) spec.image = form.image;
  if (form.thumbnail) spec.thumbnail = form.thumbnail;
  if (form.footerText) spec.footer = { text: form.footerText, ...(form.footerIconUrl ? { iconUrl: form.footerIconUrl } : {}) };
  if (form.authorName) spec.author = { name: form.authorName, ...(form.authorIconUrl ? { iconUrl: form.authorIconUrl } : {}), ...(form.authorUrl ? { url: form.authorUrl } : {}) };
  if (form.timestamp) spec.timestamp = true;
  if (form.fieldsJson?.length) spec.fields = form.fieldsJson;
  return Object.keys(spec).length ? embedSpecSchema.parse(spec) : null;
}

/** Lecture sûre d'un EmbedSpec stocké en JSON (colonnes Prisma). */
export function safeEmbedSpec(value: unknown): EmbedSpec {
  const r = embedSpecSchema.safeParse(value);
  return r.success ? r.data : {};
}

/** Lecture sûre d'une liste de ButtonSpec stockée en JSON. */
export function safeButtons(value: unknown): ButtonSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ButtonSpec[] = [];
  for (const b of value) {
    const r = buttonSpecSchema.safeParse(b);
    if (r.success) out.push(r.data);
  }
  return out.slice(0, 25);
}

/** Parse un JSON collé (EmbedSpec seul) : utilisé pour les textareas « embed JSON ». */
export const embedJsonSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      if (v.trim() === '') return null;
      try {
        return JSON.parse(v);
      } catch {
        return 'invalid-json';
      }
    }
    return v;
  },
  embedSpecSchema.nullable(),
);
