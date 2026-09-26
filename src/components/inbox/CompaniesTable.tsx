import Link from 'next/link';
import { Building2, Radar } from 'lucide-react';

import { EmptyState, typeStyles } from '@/components/patterns';
import { VerdictChip } from '@/components/scout/parts';
import { relativeTime } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import type { CompanyItem } from '@/lib/inbox/types';

/** Companies you have looked at or seen mentioned, derived from jobs and news. */
export function CompaniesTable({ items }: { items: CompanyItem[] }) {
    if (items.length === 0) {
        return (
            <EmptyState
                icon={Building2}
                title="No companies yet"
                description="Every job you share and every company named in a news post you send lands here, with your best fit at each."
            />
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
                <thead>
                    <tr className={cn(typeStyles.caption, 'border-b border-border text-left text-muted-foreground')}>
                        <th className="pb-2 font-medium">Company</th>
                        <th className="pb-2 text-right font-medium">Jobs</th>
                        <th className="pb-2 font-medium">Best fit</th>
                        <th className="pb-2 text-right font-medium">Mentions</th>
                        <th className="pb-2 font-medium">Radar</th>
                        <th className="pb-2 text-right font-medium">Last seen</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((company) => (
                        <tr key={company.name} className={cn(typeStyles.small, 'border-b border-border last:border-0')}>
                            <td className="py-2.5 font-medium text-foreground">{company.name}</td>
                            <td className="num py-2.5 text-right text-foreground">{company.jobs}</td>
                            <td className="py-2.5">
                                {company.bestFit ? (
                                    <Link href={company.bestFit.runId ? `/scout/${company.bestFit.runId}` : `/scout?tab=jobs`} className="flex flex-wrap items-baseline gap-x-2 hover:underline">
                                        <span className="text-foreground">{company.bestFit.role ?? 'Role'}</span>
                                        <VerdictChip verdict={company.bestFit.verdict} score={company.bestFit.score} />
                                    </Link>
                                ) : (
                                    <span className="text-muted-foreground">—</span>
                                )}
                            </td>
                            <td className="num py-2.5 text-right text-foreground">{company.mentions}</td>
                            <td className="py-2.5">
                                {company.radarTracked ? (
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                        <Radar aria-hidden className="size-3.5" /> Following
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">—</span>
                                )}
                            </td>
                            <td className="py-2.5 text-right text-muted-foreground">{relativeTime(company.lastSeenAt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
