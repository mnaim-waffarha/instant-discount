export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="grid h-8 w-8 place-items-center rounded-lg bg-logo text-sm font-bold text-white"
        aria-hidden
      >
        %
      </span>
      {!compact && <span className="text-base font-semibold">Instant Discount</span>}
    </span>
  );
}
