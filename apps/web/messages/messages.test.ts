import { describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en, type MessageKey } from './en';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('messages', () => {
  it('every Arabic string keeps the same {placeholders} as the English one', () => {
    const wrong = (Object.keys(en) as MessageKey[]).filter(
      (k) => placeholders(en[k]).join() !== placeholders(ar[k]).join(),
    );
    expect(wrong).toEqual([]);
  });

  it('has no empty translations', () => {
    const empty = (Object.keys(en) as MessageKey[]).filter((k) => !ar[k]?.trim());
    expect(empty).toEqual([]);
  });
});
