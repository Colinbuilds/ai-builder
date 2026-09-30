"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Calculator,
  CalendarDays,
  Camera,
  ClipboardList,

  FileSignature,
  FileText,
  Folder,
  History,
  LineChart,
  Mail,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";
import { Dropdown } from "@/components/shell/dropdown";

export type JobCounts = {
  chat: number;
  mentioned: boolean;
  email: number;
  documents: number;
  estimates: number;
  proposals: number;
  orders: number;
  invoices: number;
  events: number;
  photos: boolean;
};

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; n?: number | string; hot?: boolean };

export function jobMenu(id: string, c: JobCounts, showCosts: boolean): Item[][] {
  const b = `/projects/${id}`;
  return [
    [
      { href: `${b}/chat`, label: "Messages", icon: MessageSquare, n: c.chat, hot: c.mentioned },
      { href: `${b}/email`, label: "Communications", icon: Mail, n: c.email },
    ],
    [
      { href: `${b}/production`, label: "Schedule & crews", icon: CalendarDays, n: c.events },
      { href: `${b}/estimates`, label: "Estimates", icon: Calculator, n: c.estimates },
      { href: `${b}/plans`, label: "Plan review", icon: ClipboardList },
      { href: `${b}/proposals`, label: "Proposals", icon: FileSignature, n: c.proposals },
      { href: `${b}/orders`, label: "Orders", icon: ShoppingCart, n: c.orders },
    ],
    [
      { href: `${b}/documents`, label: "Documents", icon: Folder, n: c.documents },
      { href: `${b}/photos`, label: "Photos", icon: Camera, n: c.photos ? "✓" : 0 },
    ],
    [
      ...(showCosts
        ? [
            { href: `${b}/billing`, label: "Invoices & payments", icon: Receipt, n: c.invoices },
            { href: `${b}/costs`, label: "Profit analysis", icon: LineChart },
          ]
        : []),
      { href: `${b}#portal`, label: "Customer portal", icon: Users },
      { href: `${b}/assistant`, label: "AI assistant", icon: Bot },
    ],
    [
      { href: `${b}#history`, label: "History", icon: History },
      { href: `${b}#details`, label: "Job details & settings", icon: Settings },
    ],
  ];
}

const LABEL: [RegExp, string][] = [
  [/\/chat/, "Messages"],
  [/\/email/, "Communications"],
  [/\/production/, "Schedule & crews"],
  [/\/estimates/, "Estimates"],
  [/\/plans/, "Plan review"],
  [/\/proposals/, "Proposals"],
  [/\/orders/, "Orders"],
  [/\/documents/, "Documents"],
  [/\/photos/, "Photos"],
  [/\/billing/, "Invoices & payments"],
  [/\/costs/, "Profit analysis"],
  [/\/assistant/, "AI assistant"],
];

/** The bar under the job header: Overview, the section you're in, and the JOB MENU panel. */
export function JobMenuBar({ id, counts, showCosts }: { id: string; counts: JobCounts; showCosts: boolean }) {
  const path = usePathname();
  const base = `/projects/${id}`;
  const section = path === base ? null : (LABEL.find(([r]) => r.test(path.slice(base.length)))?.[1] ?? null);
  const groups = jobMenu(id, counts, showCosts);
  const tab = (on: boolean) => `-mb-px flex items-center gap-1.5 border-b-[3px] px-3 py-2 text-sm whitespace-nowrap ${on ? "border-[#3b7bc8] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="flex items-stretch border-b bg-background">
      <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <Link href={base} className={tab(path === base)}>
          <FileText size={15} /> Overview
        </Link>
        {section && <span className={tab(true)}>{section}</span>}
        {/* quick links on wide screens, same as the menu */}
        <span className="hidden items-stretch xl:flex">
          {groups
            .flat()
            .filter((i) => !i.href.includes("#") && !(section && LABEL.find(([, l]) => l === i.label && l === section)))
            .slice(0, 9)
            .map((i) => (
              <Link key={i.href} href={i.href} className={tab(false)}>
                {i.label}
                {!!i.n && i.n !== "✓" && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${i.hot ? "bg-[#e23b3b] text-white" : "bg-muted"}`}>{i.n}</span>}
              </Link>
            ))}
        </span>
      </nav>
      <Dropdown
        label="Job menu"
        align="right"
        width={300}
        className="flex items-center gap-2 border-l px-4 text-xs font-medium tracking-wide text-[#2c62a3] uppercase hover:bg-muted/60 dark:text-[#7fb0ea]"
        button={
          <>
            <Menu size={18} /> Job menu
          </>
        }
      >
        {groups.map((g, gi) => (
          <div key={gi} className={gi ? "border-t py-1" : "py-1"}>
            {g.map((i) => (
              <Link key={i.href} href={i.href} role="menuitem" className="flex items-center gap-3 px-4 py-1.5 text-[#2c62a3] hover:bg-muted dark:text-[#7fb0ea]">
                <i.icon size={15} className="text-[#3b7bc8]" />
                <span className="flex-1">{i.label}</span>
                {i.n !== undefined && <span className={`min-w-5 text-right text-xs tabular-nums ${i.hot ? "rounded-full bg-[#e23b3b] px-1.5 text-white" : "text-muted-foreground"}`}>{i.n}</span>}
              </Link>
            ))}
          </div>
        ))}
      </Dropdown>
    </div>
  );
}

