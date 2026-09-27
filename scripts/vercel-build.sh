#!/bin/sh
# Production builds apply pending migrations before `next build`.
#
# Production only: preview deploys share the same database, and a feature
# branch's migration must never land on it. A failing migration fails the
# build, so the previous deployment keeps serving.
#
# Which URL migrates: Supabase's direct host (db.<ref>.supabase.co:5432) is
# IPv6-only without the paid IPv4 add-on, and Vercel's build machines cannot
# reach it (P1001, 2026-09-27). The pooler in SESSION mode (same pooler host,
# port 5432) is IPv4 and supports migrations; the transaction-mode pooler
# (6543) does not. So when DATABASE_URL is the Supabase pooler, migrate through
# its session port; otherwise use DIRECT_URL as Prisma normally would.
set -e

prisma generate

if [ "$VERCEL_ENV" = "production" ]; then
    MIGRATE_URL=$(node -e '
        const raw = process.env.DATABASE_URL || "";
        try {
            const u = new URL(raw);
            if (u.hostname.endsWith(".pooler.supabase.com")) {
                u.port = "5432";
                for (const key of ["pgbouncer", "connection_limit", "pool_timeout"]) u.searchParams.delete(key);
                process.stdout.write(u.toString());
                process.exit(0);
            }
        } catch {}
        process.stdout.write(process.env.DIRECT_URL || raw);
    ')
    echo "[vercel-build] applying migrations"
    DIRECT_URL="$MIGRATE_URL" prisma migrate deploy
fi

next build
