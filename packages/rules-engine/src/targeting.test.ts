import { describe, expect, it } from 'vitest';
import { binInRange } from './targeting';

describe('binInRange', () => {
  it('matches 6-digit BIN in 6-digit range', () => {
    expect(binInRange('412345', { from: '412300', to: '412399' })).toBe(true);
    expect(binInRange('412400', { from: '412300', to: '412399' })).toBe(false);
  });

  it('matches 8-digit BIN in 6-digit range', () => {
    expect(binInRange('41234567', { from: '412345', to: '412345' })).toBe(true);
  });

  it('does not match a 6-digit BIN against a narrower 8-digit range', () => {
    expect(binInRange('412345', { from: '41234500', to: '41234549' })).toBe(false);
  });
});
