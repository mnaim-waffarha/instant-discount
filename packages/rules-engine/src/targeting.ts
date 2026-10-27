import type { BinRange, RejectReason, Targeting, TransactionContext } from './types';

const BIN_LENGTH = 8;

/**
 * A BIN matches a range only if every card it could represent is inside the range.
 * This is conservative: a 6-digit BIN never matches a narrower 8-digit range.
 */
export function binInRange(bin: string, range: BinRange): boolean {
  const low = bin.padEnd(BIN_LENGTH, '0');
  const high = bin.padEnd(BIN_LENGTH, '9');
  return low >= range.from.padEnd(BIN_LENGTH, '0') && high <= range.to.padEnd(BIN_LENGTH, '9');
}

function matches<T>(allowed: T[] | undefined, value: T | undefined): boolean {
  return !allowed || allowed.length === 0 || (value !== undefined && allowed.includes(value));
}

export function checkTargeting(t: Targeting, txn: TransactionContext): RejectReason | null {
  if (t.binRanges?.length && !t.binRanges.some((r) => binInRange(txn.bin, r)))
    return 'BIN_NOT_TARGETED';
  if (!matches(t.schemes, txn.scheme)) return 'SCHEME_NOT_TARGETED';
  if (!matches(t.merchantIds, txn.merchantId)) return 'MERCHANT_NOT_TARGETED';
  if (!matches(t.branchIds, txn.branchId)) return 'BRANCH_NOT_TARGETED';
  if (!matches(t.terminalIds, txn.terminalId)) return 'TERMINAL_NOT_TARGETED';
  if (t.excludeTerminalIds?.includes(txn.terminalId)) return 'TERMINAL_EXCLUDED';
  if (!matches(t.mccs, txn.mcc)) return 'MCC_NOT_TARGETED';
  return null;
}
