import { createElement, Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** A real heading element (h1 / h2) styled like CardTitle: the access screens had none (cfgreview 2026-10-13). */
export function AccessTitle({ level, className, children }: { level: 1 | 2; className?: string; children: ReactNode }) {
  return createElement(`h${level}`, { className: cn('font-semibold leading-none tracking-tight', className) }, children);
}

export interface Crumb { label: string; to?: string }

/** "Access > Roles > CODE": where an access screen sits (cfgreview 2026-10-13: no breadcrumb on the role editor / rows). */
export function AccessBreadcrumb({ trail }: { trail: Crumb[] }) {
  const all: Crumb[] = [{ label: 'Access', to: '/manage/access-roles' }, ...trail];
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground" data-testid="access-breadcrumb">
      {all.map((c, i) => (
        <Fragment key={`${i}-${c.label}`}>
          {i > 0 && <span aria-hidden="true" className="mx-1">/</span>}
          {c.to && i < all.length - 1 ? <Link to={c.to} className="underline">{c.label}</Link> : <span aria-current={i === all.length - 1 ? 'page' : undefined}>{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
