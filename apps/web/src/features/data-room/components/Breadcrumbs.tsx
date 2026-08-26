"use client";

import Link from "next/link";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import type { Breadcrumb } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Beyond this the bar wraps onto a second line on a narrow viewport and stops being a
 * navigation aid. The middle collapses into a menu instead — the ends are what orient
 * someone, and the hops in between stay one keystroke away.
 */
const MAX_VISIBLE_CRUMBS = 4;

export type BreadcrumbsProps = {
  /** Ordered root first, the open folder last, exactly as the API returns it. */
  crumbs: readonly Breadcrumb[];
  hrefFor: (folderId: string) => string;
};

export function Breadcrumbs({ crumbs, hrefFor }: BreadcrumbsProps) {
  const [lead] = crumbs;
  const current = crumbs[crumbs.length - 1];
  if (lead === undefined || current === undefined) return null;

  const isCollapsed = crumbs.length > MAX_VISIBLE_CRUMBS;
  const hidden = isCollapsed ? crumbs.slice(1, -2) : [];
  const trail = isCollapsed ? crumbs.slice(-2) : crumbs.slice(1);

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li className="flex items-center gap-1">
          <CrumbLabel
            crumb={lead}
            href={hrefFor(lead.id)}
            isCurrent={lead.id === current.id && crumbs.length === 1}
          />
        </li>

        {hidden.length > 0 ? (
          <li className="flex items-center gap-1">
            <Separator />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Show ${hidden.length} hidden folders in this path`}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {hidden.map((crumb) => (
                  <DropdownMenuItem key={crumb.id} asChild>
                    <Link href={hrefFor(crumb.id)} className="truncate">
                      {crumb.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}

        {trail.map((crumb) => (
          <li key={crumb.id} className="flex items-center gap-1">
            <Separator />
            <CrumbLabel
              crumb={crumb}
              href={hrefFor(crumb.id)}
              isCurrent={crumb.id === current.id}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The open folder is the page you are already on, so it is text rather than a link that
 * goes nowhere — and it carries `aria-current="page"` so it is announced as the location
 * instead of as one more destination.
 */
function CrumbLabel({
  crumb,
  href,
  isCurrent,
}: {
  crumb: Breadcrumb;
  href: string;
  isCurrent: boolean;
}) {
  if (isCurrent) {
    return (
      <span
        aria-current="page"
        className="inline-block max-w-56 truncate align-middle font-medium text-foreground"
      >
        {crumb.name}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-block max-w-40 truncate rounded-sm align-middle text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {crumb.name}
    </Link>
  );
}

function Separator() {
  return <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}
