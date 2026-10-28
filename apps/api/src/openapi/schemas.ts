import { Prisma } from '@instant-discount/db';

/** A JSON Schema / OpenAPI 3.1 schema object (or a $ref to one). */
export type Schema = Record<string, unknown>;

export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
export const str = (description?: string, extra: Schema = {}): Schema => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...extra,
});
export const uuid = (description?: string) => str(description, { format: 'uuid' });
export const dateTime = (description?: string) => str(description, { format: 'date-time' });
export const int = (description?: string): Schema => ({
  type: 'integer',
  ...(description ? { description } : {}),
});
export const num = (description?: string): Schema => ({
  type: 'number',
  ...(description ? { description } : {}),
});
export const bool = (description?: string): Schema => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});
/** Money: integer minor units (piastres / halalas). */
export const money = (description = 'Integer minor units') => int(description);
export const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });
export const arr = (items: Schema, description?: string): Schema => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});
export const enumOf = (values: readonly string[], description?: string) =>
  str(description, { enum: [...values] });
export const obj = (
  properties: Record<string, Schema>,
  required: string[] | 'all' = 'all',
  description?: string,
): Schema => ({
  type: 'object',
  properties,
  required: required === 'all' ? Object.keys(properties) : required,
  ...(description ? { description } : {}),
});
/** A model with relations or computed fields added on top. */
export const withFields = (model: string, extra: Record<string, Schema>): Schema => ({
  allOf: [ref(model), obj(extra)],
});
export const pick = (model: string, fields: string[]): Schema => {
  const props = modelProperties(model);
  return obj(Object.fromEntries(fields.map((f) => [f, props[f] ?? {}])));
};
/** Standard paginated list: `{ items, total, page, pageSize }`. */
export const page = (items: Schema): Schema =>
  obj({
    items: arr(items),
    total: int('Total matching rows'),
    page: int('1-based page number'),
    pageSize: int('Rows per page (max 200)'),
  });

/** Fields that never leave the API (secrets, token hashes). */
const HIDDEN: Record<string, string[]> = {
  Acquirer: ['hmacSecretEnc'],
  Session: ['tokenHash'],
  MagicLinkToken: ['tokenHash'],
};

const MONEY_SUFFIX = /Minor$/;

function scalar(type: string, name: string): Schema {
  switch (type) {
    case 'String':
      return { type: 'string' };
    case 'Int':
      return { type: 'integer' };
    case 'BigInt':
      // Serialised as a JSON number; money columns are minor units.
      return MONEY_SUFFIX.test(name)
        ? { type: 'integer', description: 'Integer minor units' }
        : { type: 'integer' };
    case 'Float':
    case 'Decimal':
      return { type: 'number' };
    case 'Boolean':
      return { type: 'boolean' };
    case 'DateTime':
      return { type: 'string', format: 'date-time' };
    case 'Json':
      return { description: 'JSON value' };
    default:
      throw new Error(`Unmapped Prisma type ${type} on ${name}`);
  }
}

type DmmfField = (typeof Prisma.dmmf.datamodel.models)[number]['fields'][number];

function fieldSchema(f: DmmfField): Schema {
  const base: Schema =
    f.kind === 'enum' ? ref(f.type) : f.kind === 'scalar' ? scalar(f.type, f.name) : {};
  const doc = f.documentation ? { description: f.documentation } : {};
  const one =
    Object.keys(doc).length && '$ref' in base ? { allOf: [base], ...doc } : { ...base, ...doc };
  const many = f.isList ? arr(one) : one;
  // JSON columns already accept null, so they are not wrapped.
  return f.isRequired || f.isList || f.type === 'Json' ? many : nullable(many);
}

/** Scalar and enum columns of a Prisma model as JSON Schema properties (relations excluded). */
export function modelProperties(model: string): Record<string, Schema> {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  if (!m) throw new Error(`Unknown Prisma model ${model}`);
  const hidden = new Set(HIDDEN[model] ?? []);
  return Object.fromEntries(
    m.fields
      .filter((f) => f.kind !== 'object' && !hidden.has(f.name))
      .map((f) => [f.name, fieldSchema(f)]),
  );
}

/** Component schemas for the Prisma models and enums the API returns, read from the schema. */
export function modelComponents(models: string[]): Record<string, Schema> {
  const out: Record<string, Schema> = {};
  const enums = new Set<string>();
  for (const name of models) {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
    if (!m) throw new Error(`Unknown Prisma model ${name}`);
    const props = modelProperties(name);
    out[name] = {
      type: 'object',
      ...(m.documentation ? { description: m.documentation } : {}),
      properties: props,
      required: Object.keys(props),
    };
    for (const f of m.fields) if (f.kind === 'enum') enums.add(f.type);
  }
  for (const e of Prisma.dmmf.datamodel.enums) {
    if (enums.has(e.name)) out[e.name] = { type: 'string', enum: e.values.map((v) => v.name) };
  }
  return out;
}

/** Every Prisma enum, so hand-written components can reference them too. */
export function enumComponents(): Record<string, Schema> {
  return Object.fromEntries(
    Prisma.dmmf.datamodel.enums.map((e) => [
      e.name,
      { type: 'string', enum: e.values.map((v) => v.name) },
    ]),
  );
}
