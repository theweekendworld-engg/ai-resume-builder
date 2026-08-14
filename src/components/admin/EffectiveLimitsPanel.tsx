import { COMPARISON_PLANS } from '@/lib/plans';
import type { EffectiveLimits } from '@/actions/admin';

/**
 * What the limits actually are right now.
 *
 * Read-only on purpose. Every one of these resolves from an env var with a
 * code default, so reading the source tells you the fallback and nothing about
 * what is live — and a limit you cannot see is a limit you will get wrong.
 * Changing them is an env var and a restart; the variable names are printed
 * here so nobody has to go looking.
 */
export function EffectiveLimitsPanel({ limits }: { limits: EffectiveLimits }) {
    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3">
                <h2 className="text-lg font-semibold">Plan limits, as configured</h2>
                <p className="text-sm text-muted-foreground">
                    Live values, resolved from the environment. Change one with the variable
                    named beside it and restart — no deploy.
                </p>
            </div>

            {!limits.enforced ? (
                <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground">
                    Enforcement is <strong>off</strong>. Every limit below is recorded and
                    nobody is turned away. Set <code className="font-mono">ENTITLEMENTS_ENFORCE=true</code>{' '}
                    to make them real.
                </p>
            ) : null}

            <dl className="mb-4 grid gap-3 sm:grid-cols-3">
                {[
                    {
                        label: 'Free uses per feature',
                        value: String(limits.trialUses),
                        env: 'ENTITLEMENT_FREE_TRIAL_USES',
                    },
                    {
                        label: 'Free resumes, total',
                        value: String(limits.resumeCap),
                        env: 'ENTITLEMENT_FREE_RESUME_LIFETIME_CAP',
                    },
                    {
                        label: 'Full-depth trial',
                        value: `${limits.trialDays} days`,
                        env: 'ENTITLEMENT_FREE_TRIAL_DAYS',
                    },
                ].map((item) => (
                    <div key={item.env} className="rounded-lg border border-border/60 p-3">
                        <dt className="text-sm text-muted-foreground">{item.label}</dt>
                        <dd className="mt-1 text-xl font-semibold tabular-nums">{item.value}</dd>
                        <dd className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                            {item.env}
                        </dd>
                    </div>
                ))}
            </dl>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-4">Feature</th>
                            {COMPARISON_PLANS.map((plan) => (
                                <th key={plan.name} className="py-2 pr-4">
                                    {plan.name}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {limits.rows.map((row) => (
                            <tr key={row.action} className="border-b border-border/60">
                                <th scope="row" className="py-2 pr-4 font-normal">
                                    <span className="text-foreground">{row.label}</span>
                                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                                        {row.action}
                                    </span>
                                </th>
                                {row.values.map((value, index) => (
                                    <td
                                        key={COMPARISON_PLANS[index].name}
                                        className="py-2 pr-4 tabular-nums text-foreground"
                                    >
                                        {value}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
                Override one cell with{' '}
                <code className="font-mono">ENTITLEMENT_LIMIT_&lt;TIER&gt;_&lt;ACTION&gt;</code> — tiers
                are FREE, ALWAYS_ON (Career), PRO (Search). <code className="font-mono">unlimited</code>{' '}
                and <code className="font-mono">0</code> are both valid.
            </p>

            <div className="mt-4 overflow-x-auto">
                <h3 className="mb-2 text-sm font-medium text-foreground">
                    Monthly cost backstop
                </h3>
                <table className="w-full min-w-[420px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-4">Plan</th>
                            <th className="py-2 pr-4">Tokens</th>
                            <th className="py-2">Spend</th>
                        </tr>
                    </thead>
                    <tbody>
                        {limits.tokens.map((row) => (
                            <tr key={row.plan} className="border-b border-border/60">
                                <th scope="row" className="py-2 pr-4 font-normal text-foreground">
                                    {row.plan}
                                </th>
                                <td className="py-2 pr-4 tabular-nums">{row.tokens}</td>
                                <td className="py-2 tabular-nums">{row.costUsd}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                    A backstop, not a product limit — someone should meet their feature quota
                    long before this. <code className="font-mono">ENTITLEMENT_TOKENS_&lt;TIER&gt;</code>,{' '}
                    <code className="font-mono">ENTITLEMENT_COST_USD_&lt;TIER&gt;</code>.
                </p>
            </div>
        </section>
    );
}
