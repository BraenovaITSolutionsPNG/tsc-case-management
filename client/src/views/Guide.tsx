"use client";

import { OrganisationLogos } from "@/components/OrganisationLogos";
import { Button } from "@/components/ui/button";
import { matterTypeValues } from "@shared/matters";
import { ROLE_TITLES, ROLE_VALUES } from "@shared/roles";
import { STATUS_LABELS, STATUS_VALUES } from "@shared/statuses";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The officer's guide.
 *
 * Reachable without a session, because the sign-in screen offers it and an
 * officer who cannot yet sign in is the one who most needs it. It answers the
 * four questions that come up before a first case is filed — how do I get in,
 * what do I file, what do the status codes mean, and who can do what — and
 * stops there. Anything an officer needs to *do* belongs in the application,
 * not in a page that can drift away from it.
 *
 * The lists are read from `shared/` rather than written out, so a status or a
 * role added there appears here without a second edit. A guide that quotes a
 * stale list of status codes is worse than no guide.
 */

const SECTIONS = [
  {
    heading: "Signing in",
    body: [
      "Use the username the platform administrator issued you and the password they set. Accounts are not created from this platform: the administrator registers each officer, assigns a role, and re-keys a forgotten password.",
      "“Remember sign in details” keeps your username on this device. It never stores your password.",
    ],
  },
  {
    heading: "Filing a matter",
    body: [
      "Choose Register matter from the navigation. Every matter is filed under one of three classes, one province and one of the eleven status codes below.",
      "The province decides the office that receives it, and the class decides the National Section it is referred to by default.",
    ],
  },
  {
    heading: "Keeping the register honest",
    body: [
      "Deadlines drive escalation. A matter that passes its due date is flagged as delayed on the overview, and matters that stay delayed long enough move to Escalated due to delay.",
      "Update a matter as it moves rather than at the end. The quarterly returns and the reports are counted from what is on the register at the moment they are run.",
    ],
  },
] as const;

export default function Guide() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <OrganisationLogos
              markClassName="h-9 w-12"
              sizes="48px"
              width={48}
              height={36}
            />
            <span className="text-lg font-bold tracking-tight text-slate-900">
              tsc<span className="text-teal-600">matters</span>
            </span>
          </div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 py-12 sm:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Officer&apos;s guide
        </h1>
        <p className="mt-2 text-slate-600">
          How the Provincial Matters platform is used, and what each part of it
          means. Nothing here is a substitute for the Provincial Matters
          Administration Manual — this is the short version of the parts you
          touch day to day.
        </p>

        {SECTIONS.map(section => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-lg font-semibold text-slate-900">
              {section.heading}
            </h2>
            {section.body.map(paragraph => (
              <p
                key={paragraph}
                className="mt-2 text-[0.9375rem] leading-7 text-slate-600"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">
            Classes of matter
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {matterTypeValues.map(value => (
              <li
                key={value}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[0.9375rem] text-slate-700"
              >
                {value}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Status codes</h2>
          <p className="mt-2 text-[0.9375rem] leading-7 text-slate-600">
            The standard status codes the Director monitors cases by. A matter
            carries exactly one at a time.
          </p>
          <dl className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {STATUS_VALUES.map(status => (
              <div
                key={status}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
              >
                <dt className="w-12 shrink-0 font-mono text-xs font-semibold text-slate-500">
                  {status}
                </dt>
                <dd className="text-[0.9375rem] text-slate-700">
                  {STATUS_LABELS[status]}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Roles</h2>
          <p className="mt-2 text-[0.9375rem] leading-7 text-slate-600">
            A higher tier holds every capability of the tiers below it, and the
            navigation hides a destination a role cannot use rather than
            offering a link that returns a refusal.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {ROLE_VALUES.map(role => (
              <li
                key={role}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <span className="block text-[0.9375rem] font-medium text-slate-800">
                  {ROLE_TITLES[role]}
                </span>
                <span className="block font-mono text-xs text-slate-500">
                  {role}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-12 border-t border-slate-200 pt-8">
          <Link href="/login">
            <Button variant="outline">Go to sign in</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
