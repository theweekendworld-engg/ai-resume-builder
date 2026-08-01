'use client';

/**
 * The `/dev/patterns` gallery.
 *
 * Every component, every variant, every state, in both themes and at all three
 * densities — driven entirely by the fixtures in `./fixtures.ts`. No data
 * layer, no API, no database.
 *
 * This is the artefact that stops three later phases from restyling: if a
 * state is not on this page, it has not been designed.
 */

import * as React from 'react';
import { FolderOpen, Github, Inbox, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

import { CategoryChip } from './category-chip';
import { DensityProvider, type Density } from './density';
import { EmptyState } from './empty-state';
import {
  LONG_QUEUE_ITEMS,
  PROGRESS_STAGES,
  PROGRESS_STAGES_ERROR,
  QUEUE_ITEMS,
  SOURCES,
  WINS,
} from './fixtures';
import { GroundChip } from './ground-chip';
import { MetricChip } from './metric-chip';
import { ProgressStages } from './progress-stages';
import { QuotaMeter } from './quota-meter';
import { ReviewQueue } from './review-queue';
import { SourceChip, SourceChipGroup } from './source-chip';
import { StatTile } from './stat-tile';
import { StreakBadge } from './streak-badge';
import { focusRing, typeStyles } from './tokens';
import { WIN_CATEGORIES, type WinRecord } from './types';
import { WinCard, type WinCardState } from './win-card';

/* -------------------------------------------------------------------------- */
/* Layout helpers                                                              */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h2 className={cn(typeStyles.h2, 'text-foreground')}>{title}</h2>
        {note ? <p className={cn(typeStyles.small, 'text-muted-foreground')}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Case({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className={cn(typeStyles.caption, 'uppercase text-muted-foreground')}>{label}</p>
      {children}
    </div>
  );
}

function Cluster({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Gallery                                                                     */
/* -------------------------------------------------------------------------- */

export function PatternsGallery() {
  const [density, setDensity] = React.useState<Density>('default');

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className={cn(typeStyles.h1, 'text-foreground')}>Pattern library</h1>
            <p className={cn(typeStyles.small, 'text-muted-foreground')}>
              docs/design/01-components.md &middot; fixtures only, no data layer
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>Density</span>
            {(['compact', 'default', 'relaxed'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDensity(option)}
                aria-pressed={density === option}
                className={cn(
                  typeStyles.caption,
                  focusRing,
                  'rounded-full border px-3 py-1 transition-colors duration-[120ms]',
                  density === option
                    ? 'border-border bg-secondary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-6 2xl:grid-cols-2">
          <ThemePane theme="light" density={density} />
          <ThemePane theme="dark" density={density} />
        </div>
      </div>
    </div>
  );
}

function ThemePane({ theme, density }: { theme: 'light' | 'dark'; density: Density }) {
  return (
    <div className={cn(theme, 'rounded-xl border border-border bg-background text-foreground')}>
      <div className="sticky top-0 z-30 rounded-t-xl border-b border-border bg-background px-6 py-3">
        <p className={cn(typeStyles.caption, 'uppercase text-muted-foreground')}>
          {theme} &middot; density-{density}
        </p>
      </div>
      <DensityProvider density={density} className="space-y-6 px-6 py-6">
        <AtomsSection />
        <WinCardSection />
        <SupportingSection />
        <ReviewQueueSection />
        <MetersSection />
        <DensitySection />
      </DensityProvider>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Atoms                                                                    */
/* -------------------------------------------------------------------------- */

function AtomsSection() {
  return (
    <Section
      title="1 · Atoms"
      note="SourceChip, GroundChip, CategoryChip, MetricChip. These block everything else."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Case label="SourceChip · one per EvidenceKind">
          <Cluster>
            <SourceChip source={SOURCES.pr} />
            <SourceChip source={SOURCES.doc} />
            <SourceChip source={SOURCES.url} />
            <SourceChip source={SOURCES.interview} />
            <SourceChip source={SOURCES.metric} />
            <SourceChip source={SOURCES.imported} />
          </Cluster>
        </Case>

        <Case label="SourceChip · dead source, and the +n collapse">
          <Cluster>
            <SourceChip source={SOURCES.dead} />
            <SourceChipGroup
              sources={[SOURCES.pr, SOURCES.doc, SOURCES.url, SOURCES.interview, SOURCES.imported]}
            />
            <SourceChipGroup sources={[SOURCES.pr, SOURCES.doc, SOURCES.url]} static />
          </Cluster>
        </Case>

        <Case label="GroundChip · default size">
          <Cluster>
            <GroundChip state="grounded" backedBy="PR #482" excerpt="p95 fell from 812ms to 178ms." />
            <GroundChip state="needs_confirmation" claim="Cut latency by 77%" />
            <GroundChip state="unsupported" />
          </Cluster>
        </Case>

        <Case label="GroundChip · sm (icon only, label kept for screen readers)">
          <Cluster>
            <GroundChip size="sm" state="grounded" backedBy="PR #482" />
            <GroundChip size="sm" state="needs_confirmation" claim="Cut latency by 77%" />
            <GroundChip size="sm" state="unsupported" />
            <span className={cn(typeStyles.small, 'text-muted-foreground')}>
              inline in a sentence: latency fell 77%{' '}
              <GroundChip size="sm" state="grounded" backedBy="PR #482" /> last quarter
            </span>
          </Cluster>
        </Case>

        <Case label="GroundChip · producer (click to capture evidence)">
          <Cluster>
            <GroundChip
              state="needs_confirmation"
              claim="Cut checkout p95 latency 800ms → 180ms"
              onConfirm={async () => {
                await new Promise((resolve) => setTimeout(resolve, 400));
              }}
            />
            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>
              resolves to grounded after ~400ms
            </span>
          </Cluster>
        </Case>

        <Case label="MetricChip · absence is meaningful, so there is no empty variant">
          <Cluster>
            <MetricChip metric={{ value: '−77%', detail: '812ms → 178ms' }} />
            <MetricChip metric={{ value: '+$41k MRR' }} />
            <MetricChip metric={{ value: '4 → 11' }} />
          </Cluster>
        </Case>

        <Case label="CategoryChip · icons, never hues (foundations §3.3)" className="md:col-span-2">
          <Cluster>
            {WIN_CATEGORIES.map((category) => (
              <CategoryChip key={category} category={category} />
            ))}
          </Cluster>
        </Case>

        <Case label="CategoryChip · inline (card meta row), clickable filter, icon only">
          <Cluster>
            <CategoryChip category="improved" appearance="inline" />
            <CategoryChip category="shipped" onClick={() => {}} />
            <CategoryChip category="led" onClick={() => {}} active />
            <CategoryChip category="saved" iconOnly />
          </Cluster>
        </Case>

        <Case label="StreakBadge · never resets visibly to zero">
          <Cluster>
            <StreakBadge weeks={6} />
            <StreakBadge weeks={2} />
            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>
              weeks={'{1}'} and weeks={'{0}'} render nothing &rarr;
            </span>
            <StreakBadge weeks={1} />
            <StreakBadge weeks={0} />
          </Cluster>
        </Case>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. WinCard                                                                  */
/* -------------------------------------------------------------------------- */

const STATE_CASES: Array<{ state: WinCardState; label: string; win: WinRecord }> = [
  { state: 'default', label: 'default', win: WINS[0] },
  { state: 'draft', label: 'draft — left rule in --info', win: WINS[5] },
  { state: 'confirmed', label: 'confirmed (just now) — 8s success tint', win: WINS[0] },
  { state: 'dismissed', label: 'dismissed — undo window', win: WINS[3] },
  { state: 'editing', label: 'editing — ⌘↵ saves, Esc cancels', win: WINS[1] },
  { state: 'error', label: 'error — readable, inline retry', win: WINS[4] },
  { state: 'skeleton', label: 'skeleton — 40% / 90% / 60%', win: WINS[0] },
];

function WinCardSection() {
  const [replayKey, setReplayKey] = React.useState(0);

  return (
    <Section
      title="2 · WinCard"
      note="Variants list / review / compact / preview, and every state in the table."
    >
      <div className="space-y-4">
        <Case label="variant=list — the default">
          <WinCard win={WINS[0]} variant="list" onOpen={() => {}} onMenuAction={() => {}} />
        </Case>

        <div className="grid gap-4 lg:grid-cols-2">
          <Case label="list · hover (forced)">
            <WinCard
              win={WINS[0]}
              variant="list"
              onOpen={() => {}}
              onMenuAction={() => {}}
              forceVisualState="hover"
            />
          </Case>
          <Case label="list · focused (forced)">
            <WinCard
              win={WINS[0]}
              variant="list"
              onOpen={() => {}}
              onMenuAction={() => {}}
              forceVisualState="focused"
            />
          </Case>
        </div>

        <Case label="list · sensitivity — internal_only (lock outline) and confidential (filled lock + warning rule)">
          <div className="space-y-1">
            <WinCard win={WINS[1]} variant="list" onOpen={() => {}} onMenuAction={() => {}} />
            <WinCard win={WINS[2]} variant="list" onOpen={() => {}} onMenuAction={() => {}} />
          </div>
        </Case>

        <Case label="variant=review — actions always visible, plus the From: line">
          <WinCard
            win={WINS[0]}
            variant="review"
            onConfirm={() => {}}
            onDismiss={() => {}}
            onMenuAction={() => {}}
          />
        </Case>

        <div className="grid gap-4 lg:grid-cols-2">
          <Case label="variant=compact — title + date, 40px">
            <div className="space-y-1">
              <WinCard win={WINS[0]} variant="compact" onOpen={() => {}} />
              <WinCard win={WINS[2]} variant="compact" onOpen={() => {}} />
              <WinCard win={WINS[4]} variant="compact" onOpen={() => {}} />
            </div>
          </Case>
          <Case label="variant=preview — non-interactive">
            <WinCard win={WINS[6]} variant="preview" />
          </Case>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {STATE_CASES.map((entry) => (
            <Case key={entry.state} label={entry.label}>
              <WinCard
                win={entry.win}
                variant={entry.state === 'editing' || entry.state === 'error' ? 'review' : 'list'}
                state={entry.state}
                onOpen={() => {}}
                onMenuAction={() => {}}
                onConfirm={() => {}}
                onDismiss={() => {}}
                onUndo={() => {}}
                onRetry={() => {}}
                onEditSave={() => {}}
                onEditCancel={() => {}}
              />
            </Case>
          ))}
        </div>

        <Case label="confirming — the §7.2 timeline, frozen frame by frame">
          <div className="grid gap-3 lg:grid-cols-3">
            {(['press', 'flash', 'fade'] as const).map((phase) => (
              <div key={phase} className="space-y-1">
                <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                  {phase === 'press'
                    ? 't=0 press + check sweep'
                    : phase === 'flash'
                      ? 't=60 flash --success/8%'
                      : 't=100 desaturate to 60%'}
                </p>
                <WinCard
                  win={WINS[0]}
                  variant="review"
                  state="confirming"
                  confirmPhase={phase}
                  onConfirm={() => {}}
                  onDismiss={() => {}}
                />
              </div>
            ))}
          </div>
          <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
            t=180 collapses the row height to 0 — it renders as nothing, which is the point.
          </p>
        </Case>

        <Case label="confirming — live, ~400ms end to end">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setReplayKey((key) => key + 1)}
              className={cn(
                typeStyles.caption,
                focusRing,
                'rounded-full border border-border px-3 py-1 text-foreground hover:bg-secondary'
              )}
            >
              Replay
            </button>
            <WinCard
              key={replayKey}
              win={WINS[0]}
              variant="review"
              state="confirming"
              onConfirm={() => {}}
              onDismiss={() => {}}
            />
          </div>
        </Case>

        <Case label="bulk in flight — row disabled, per-row spinner">
          <WinCard win={WINS[7]} variant="review" busy onConfirm={() => {}} onDismiss={() => {}} />
        </Case>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. EmptyState, StatTile                                                     */
/* -------------------------------------------------------------------------- */

function SupportingSection() {
  return (
    <Section title="3 · EmptyState, StatTile" note="Exactly one primary action. Never apologize.">
      <div className="space-y-4">
        <Case label="EmptyState · log first-run, with samples behind a Sample caption">
          <EmptyState
            icon={Github}
            title="No wins yet"
            description="Connect GitHub and we'll draft your last 90 days in about a minute."
            action={{ label: 'Connect GitHub', onClick: () => {} }}
            secondary={{ label: 'or log one manually', onClick: () => {} }}
            samples={WINS.slice(0, 3)}
          />
        </Case>

        <div className="grid gap-4 lg:grid-cols-2">
          <Case label="EmptyState · filtered to zero">
            <EmptyState
              icon={Search}
              title="No wins match these filters"
              description="Widen the date range or clear the category filter to see the rest of your log."
              action={{ label: 'Clear filters', onClick: () => {} }}
            />
          </Case>

          <Case label="EmptyState · no packets">
            <EmptyState
              icon={FolderOpen}
              title="No review packets"
              description="A packet turns your logged wins into a document you can share with your manager."
              action={{ label: 'Create a packet', onClick: () => {} }}
            />
          </Case>
        </div>

        <Case label="EmptyState · review queue done (no action needed)">
          <EmptyState
            icon={Inbox}
            title="Nothing to review"
            description="New wins land here every Monday. You'll get an email when they do."
          />
        </Case>

        <Case label="StatTile · default, wide, verdict">
          <div className="grid gap-3 md:grid-cols-3">
            <StatTile
              value={74}
              label="wins logged"
              delta={{ value: '+8 this month', direction: 'up' }}
              sparkline={[3, 5, 4, 9, 12, 14]}
              sparklineLabel="6 mo"
              hint="Every Win with status confirmed, counted once, over the life of your account."
            />
            <StatTile
              variant="wide"
              value={12}
              label="grounded claims"
              delta={{ value: '−1 this week', direction: 'down' }}
            />
            <StatTile
              variant="verdict"
              value="Strong"
              label="competency coverage"
              dots={4}
              hint="Four of five competencies have at least two grounded wins in the last two quarters."
            />
          </div>
        </Case>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. ReviewQueue                                                              */
/* -------------------------------------------------------------------------- */

function ReviewQueueSection() {
  const [resetKey, setResetKey] = React.useState(0);

  return (
    <Section
      title="4 · ReviewQueue"
      note="Click into a queue, then: j/k move · y confirm · n dismiss · e edit · u undo · 1–8 recategorize · ? help · Esc exit."
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setResetKey((key) => key + 1)}
          className={cn(
            typeStyles.caption,
            focusRing,
            'rounded-full border border-border px-3 py-1 text-foreground hover:bg-secondary'
          )}
        >
          Reset all queues
        </button>

        <Case label="1–5 items — the standard case">
          <ReviewQueue key={`short-${resetKey}`} items={QUEUE_ITEMS} showHintBar toasts={false} />
        </Case>

        <Case label="More than 5 — bounded at 5 with a Show n more control">
          <ReviewQueue
            key={`long-${resetKey}`}
            items={LONG_QUEUE_ITEMS}
            showHintBar={false}
            toasts={false}
          />
        </Case>

        <Case label="Partial bulk failure — press Confirm all; the third row fails and offers retry">
          <ReviewQueue
            key={`failing-${resetKey}`}
            items={QUEUE_ITEMS}
            showHintBar={false}
            toasts={false}
            onConfirm={async (win) => {
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (win.id === 'queue-3') {
                throw new Error('The API rejected that claim. Retry?');
              }
            }}
          />
        </Case>

        <Case label="Completion — action the single row to see it; the block leaves after 10s">
          <ReviewQueue
            key={`single-${resetKey}`}
            items={QUEUE_ITEMS.slice(0, 1)}
            showHintBar={false}
            toasts={false}
          />
        </Case>

        <Case label="Empty — the block does not render at all, by design">
          <div className="rounded-xl border border-dashed border-border px-4 py-6">
            <ReviewQueue items={[]} />
            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
              (nothing above this line — no &ldquo;nothing to review&rdquo; card, that would be noise)
            </p>
          </div>
        </Case>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. QuotaMeter, ProgressStages                                               */
/* -------------------------------------------------------------------------- */

function MetersSection() {
  return (
    <Section title="5 · QuotaMeter, ProgressStages">
      <div className="grid gap-4 lg:grid-cols-2">
        <Case label="QuotaMeter · neutral, warning at 80%, danger at 100%">
          <div className="space-y-4 rounded-lg border border-border p-4">
            <QuotaMeter used={4} limit={15} unit="tailored resumes" resetsOn="2026-09-01T00:00:00.000Z" />
            <QuotaMeter used={12} limit={15} unit="tailored resumes" resetsOn="2026-09-01T00:00:00.000Z" />
            <QuotaMeter used={15} limit={15} unit="tailored resumes" resetsOn="2026-09-01T00:00:00.000Z" />
          </div>
        </Case>

        <Case label="ProgressStages · never a bare spinner">
          <div className="space-y-3">
            <ProgressStages stages={PROGRESS_STAGES} title="Building your packet" />
            <ProgressStages stages={PROGRESS_STAGES_ERROR} />
          </div>
        </Case>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Density                                                                  */
/* -------------------------------------------------------------------------- */

function DensitySection() {
  return (
    <Section
      title="6 · Density"
      note="All three at once, so the 48 / 56 / auto row heights can be compared directly."
    >
      <div className="space-y-3">
        {(['compact', 'default', 'relaxed'] as const).map((option) => (
          <Case key={option} label={`density-${option}`}>
            <DensityProvider density={option} className="space-y-1">
              <WinCard win={WINS[0]} variant="list" onOpen={() => {}} onMenuAction={() => {}} />
              <WinCard win={WINS[2]} variant="list" onOpen={() => {}} onMenuAction={() => {}} />
            </DensityProvider>
          </Case>
        ))}
      </div>
    </Section>
  );
}
