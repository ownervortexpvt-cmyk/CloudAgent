'use client'

/**
 * v116 — the ONE recharts chart in Settings (daily token stack), extracted
 * so the 700KB recharts library loads only when the Usage tab actually
 * renders a chart — not inside the Settings dialog chunk on every open.
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

export default function UsageTokenChart({ series }: { series: { day: string; tokensIn: number; tokensOut: number }[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fontSize: 9 }} tickFormatter={(n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))} />
          <ReTooltip
            contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
            formatter={(value: any, name: any) => [Number(value).toLocaleString(), name === 'tokensIn' ? 'Tokens in' : 'Tokens out']}
            labelFormatter={(d: any) => `Day ${String(d)}`}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v) => (v === 'tokensIn' ? 'Tokens in' : 'Tokens out')} />
          <Bar dataKey="tokensIn" stackId="t" fill="#38bdf8" radius={[0, 0, 0, 0]} />
          <Bar dataKey="tokensOut" stackId="t" fill="#a78bfa" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
