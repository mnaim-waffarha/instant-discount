'use client';

import { useState } from 'react';
import { formatDate, formatMoney, formatNumber, type Locale } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface Point {
  day: string;
  redemptions: number;
  discountMinor: number;
}

const H = 180;
const PAD = { top: 16, right: 8, bottom: 24, left: 48 };
const MAX_BAR = 24;
const GAP = 2;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

function compact(minor: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100);
}

/**
 * Daily discount columns (single series, so no legend; the card title names it).
 * Brand blue (PANTONE 7687 C, lightened for charts); the peak is labelled and a table view is provided.
 */
export function DailyChart({
  data,
  currency,
  timeZone,
}: {
  data: Point[];
  currency: string;
  timeZone: string;
}) {
  const { locale, t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const width = Math.max(320, data.length * 28 + PAD.left + PAD.right);
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.discountMinor), 0));
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(MAX_BAR, slot - GAP);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const peak = data.reduce(
    (best, d, i) => (d.discountMinor > (data[best]?.discountMinor ?? -1) ? i : best),
    0,
  );
  const ticks = [0, max / 2, max];
  const dateLabel = (day: string) => formatDate(`${day}T12:00:00Z`, locale, 'UTC');

  return (
    <div>
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${H}`}
          className="h-[180px] min-w-full"
          style={{ width }}
          role="img"
          aria-label={t('campaign.daily')}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="#EDEFF2"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="#8A919E"
              >
                {compact(v, locale)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const top = y(d.discountMinor);
            const h = Math.max(0, PAD.top + plotH - top);
            const r = Math.min(4, h, barW / 2);
            // Rounded data end, square at the baseline.
            const path = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* Hit target taller and wider than the mark. */}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                />
                {h > 0 && (
                  <path
                    d={path}
                    fill="#2C59B0"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i === peak && d.discountMinor > 0 && (
                  <text
                    x={x + barW / 2}
                    y={top - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#1A1D23"
                  >
                    {compact(d.discountMinor, locale)}
                  </text>
                )}
              </g>
            );
          })}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="#D5D9E0"
            strokeWidth={1}
          />
          {data.length > 0 && (
            <>
              <text x={PAD.left} y={H - 6} fontSize={10} fill="#8A919E">
                {dateLabel(data[0]!.day)}
              </text>
              <text x={width - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="#8A919E">
                {dateLabel(data[data.length - 1]!.day)}
              </text>
            </>
          )}
        </svg>
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-card"
            style={{ left: Math.min(width - 160, PAD.left + hover * slot + slot / 2 + 8) }}
          >
            <div className="font-medium">{dateLabel(data[hover].day)}</div>
            <div>{formatMoney(data[hover].discountMinor, currency, locale)}</div>
            <div className="text-ink-muted">
              {formatNumber(data[hover].redemptions, locale)} {t('campaign.redemptions')}
            </div>
          </div>
        )}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-ink-muted">{t('common.details')}</summary>
        <table className="mt-2 w-full">
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-b border-line last:border-0">
                <td className="py-1">{dateLabel(d.day)}</td>
                <td className="py-1 text-end">{formatNumber(d.redemptions, locale)}</td>
                <td className="py-1 text-end">{formatMoney(d.discountMinor, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <span className="sr-only">{timeZone}</span>
    </div>
  );
}
