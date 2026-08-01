'use client';

import * as React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';

import { CategoryChip, WIN_CATEGORIES, focusRing, typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import {
  activeChips,
  STATUS_SEGMENTS,
  UNATTRIBUTED,
  type LogFilterState,
  type StatusSegment,
} from './filters';

const ALL = '__all__';

export interface LogFiltersProps {
  filters: LogFilterState;
  onChange: (next: LogFilterState) => void;
  employers: Array<{ id: string; name: string }>;
  years: number[];
  /** Count of Wins matching the current filter, announced politely. */
  resultCount: number;
  className?: string;
}

/**
 * The filter bar.
 *
 * Below 640px the controls move into a bottom sheet (§B responsive) and only
 * search stays inline — search is the one filter people reach for on a phone,
 * and a four-way segmented control at 360px is a row of unreadable stubs.
 */
export function LogFilters({
  filters,
  onChange,
  employers,
  years,
  resultCount,
  className,
}: LogFiltersProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const chips = activeChips(filters, employers);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <Segmented
          value={filters.segment}
          onChange={(segment) => onChange({ ...filters, segment })}
          className="hidden sm:inline-flex"
        />

        <div className="hidden items-center gap-2 sm:flex">
          <YearSelect
            value={filters.year}
            years={years}
            onChange={(year) => onChange({ ...filters, year })}
          />
          <EmployerSelect
            value={filters.employerId}
            employers={employers}
            onChange={(employerId) => onChange({ ...filters, employerId })}
          />
          <CategoryFilter
            value={filters.categories}
            onChange={(categories) => onChange({ ...filters, categories })}
          />
        </div>

        <SearchField
          value={filters.search}
          onChange={(search) => onChange({ ...filters, search })}
          className="min-w-0 flex-1"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 sm:hidden"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {chips.length > 0 ? <span className="num">{chips.length}</span> : null}
        </Button>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.next)}
              aria-label={`Remove filter: ${chip.label}`}
              className={cn(
                typeStyles.caption,
                focusRing,
                'inline-flex h-5 items-center gap-1 rounded-full border border-border bg-secondary px-2 text-secondary-foreground',
                'transition-colors duration-[120ms] ease-out hover:bg-secondary/70',
              )}
            >
              {chip.label}
              <X aria-hidden="true" className="size-3" strokeWidth={1.5} />
            </button>
          ))}
        </div>
      ) : null}

      {/* The result count is the one thing a filter change must announce. */}
      <p aria-live="polite" className="sr-only">
        {resultCount === 1 ? '1 win' : `${resultCount} wins`}
      </p>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className={typeStyles.h2}>Filters</SheetTitle>
            <SheetDescription className={typeStyles.small}>
              {resultCount === 1 ? '1 win' : `${resultCount} wins`} match
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <Segmented
              value={filters.segment}
              onChange={(segment) => onChange({ ...filters, segment })}
              className="w-full"
            />
            <YearSelect
              value={filters.year}
              years={years}
              onChange={(year) => onChange({ ...filters, year })}
              className="w-full"
            />
            <EmployerSelect
              value={filters.employerId}
              employers={employers}
              onChange={(employerId) => onChange({ ...filters, employerId })}
              className="w-full"
            />
            <div className="flex flex-wrap gap-1.5">
              {WIN_CATEGORIES.map((category) => (
                <CategoryChip
                  key={category}
                  category={category}
                  active={filters.categories.includes(category)}
                  onClick={() =>
                    onChange({
                      ...filters,
                      categories: filters.categories.includes(category)
                        ? filters.categories.filter((entry) => entry !== category)
                        : [...filters.categories, category],
                    })
                  }
                />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Segmented({
  value,
  onChange,
  className,
}: {
  value: StatusSegment;
  onChange: (next: StatusSegment) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Win status"
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card p-0.5',
        className,
      )}
    >
      {STATUS_SEGMENTS.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(segment.value)}
            className={cn(
              typeStyles.caption,
              focusRing,
              'inline-flex h-8 flex-1 items-center justify-center rounded-md px-3 transition-colors duration-[120ms] ease-out',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}

function YearSelect({
  value,
  years,
  onChange,
  className,
}: {
  value: number | null;
  years: number[];
  onChange: (next: number | null) => void;
  className?: string;
}) {
  return (
    <Select
      value={value === null ? ALL : String(value)}
      onValueChange={(next) => onChange(next === ALL ? null : Number(next))}
    >
      <SelectTrigger
        aria-label="Year"
        className={cn('num h-9 w-auto gap-2 border-border bg-card text-xs', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All years</SelectItem>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)} className="num">
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmployerSelect({
  value,
  employers,
  onChange,
  className,
}: {
  value: string | null;
  employers: Array<{ id: string; name: string }>;
  onChange: (next: string | null) => void;
  className?: string;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
    >
      <SelectTrigger
        aria-label="Employer"
        className={cn('h-9 w-auto gap-2 border-border bg-card text-xs', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All employers</SelectItem>
        {employers.map((employer) => (
          <SelectItem key={employer.id} value={employer.id}>
            {employer.name}
          </SelectItem>
        ))}
        <SelectItem value={UNATTRIBUTED}>No employer</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CategoryFilter({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (next: (typeof WIN_CATEGORIES)[number][]) => void;
}) {
  const selected = value as (typeof WIN_CATEGORIES)[number][];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 text-xs">
          Category
          {selected.length > 0 ? <span className="num">{selected.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex flex-wrap gap-1.5">
          {WIN_CATEGORIES.map((category) => (
            <CategoryChip
              key={category}
              category={category}
              active={selected.includes(category)}
              onClick={() =>
                onChange(
                  selected.includes(category)
                    ? selected.filter((entry) => entry !== category)
                    : [...selected, category],
                )
              }
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SearchField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.5}
      />
      <Input
        type="search"
        aria-label="Search your wins"
        placeholder="Search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 border-border bg-card pl-9 text-sm"
      />
    </div>
  );
}
