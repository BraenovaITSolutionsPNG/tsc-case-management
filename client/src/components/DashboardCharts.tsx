"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@server/routers";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS_VALUES, STATUS_SHORT, type CaseStatus } from "@shared/statuses";

/**
 * The dashboard's three charts: intake against closure, the register's spread
 * across statuses, and where the load sits by province.
 *
 * All three read from the single `caseManagement.dashboard` payload rather than
 * issuing their own queries: they are three views of the same register, and
 * three round trips would show three slightly different moments.
 */

// The eleven status colours, muted to match the status plates so a chart
// segment and a row badge are recognisably the same state.
const STATUS_CHART_COLOURS: Record<CaseStatus, string> = {
  NEW: "#38bdf8",
  VER: "#f59e0b",
  INV: "#8b5cf6",
  REF: "#f97316",
  ADV: "#6366f1",
  DEC: "#ec4899",
  LEG: "#f43f5e",
  ACT: "#14b8a6",
  RES: "#10b981",
  CLS: "#94a3b8",
  ESC: "#ef4444",
};

const PROVINCE_COLOURS = [
  "#1d4ed8",
  "#0891b2",
  "#7c3aed",
  "#c2410c",
  "#0f766e",
  "#be123c",
  "#4d7c0f",
  "#a16207",
];

/**
 * Inferred from the router, for the same reason as `CaseMonitoringBoard`: the
 * status and province keys are string unions on the server, and a restated copy
 * would accept provinces that do not exist.
 */
export type DashboardData = inferRouterOutputs<AppRouter>["caseManagement"]["dashboard"];

function Panel({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-4",
        className
      )}
    >
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-slate-600">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function DashboardCharts({ data }: { data: DashboardData }) {
  const statusData = STATUS_VALUES.map(status => ({
    name: STATUS_SHORT[status],
    key: status,
    value: data.statusCounts[status] ?? 0,
  })).filter(row => row.value > 0);

  const provinceData = Object.entries(data.provinceCounts)
    .map(([province, count]) => ({ province, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Intake against closure"
        description="Matters received and closed over the last six months."
        className="lg:col-span-2"
      >
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.intakeByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="received" name="Received" fill="#1d4ed8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel
        title="Where matters currently sit"
        description="Every status in the register."
      >
        {statusData.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            No matters in the register yet.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={1}
                >
                  {statusData.map(row => (
                    <Cell
                      key={row.key}
                      fill={STATUS_CHART_COLOURS[row.key as CaseStatus]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel
        title="Load by province"
        description="Matters on the register in each province."
      >
        {provinceData.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            Nothing recorded for any province yet.
          </p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={provinceData}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" stroke="#64748b" fontSize={12} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="province"
                  stroke="#64748b"
                  fontSize={12}
                  width={72}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Matters" radius={[0, 3, 3, 0]}>
                  {provinceData.map((row, index) => (
                    <Cell
                      key={row.province}
                      fill={PROVINCE_COLOURS[index % PROVINCE_COLOURS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * A compact closure trend, used on the reports screen where the full charts
 * would not fit alongside the quarterly return.
 */
export function ClosureTrend({
  data,
}: {
  data: { key: string; label: string; received: number; closed: number }[];
}) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
          <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="received"
            name="Received"
            stroke="#1d4ed8"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
          <Line
            type="monotone"
            dataKey="closed"
            name="Closed"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
