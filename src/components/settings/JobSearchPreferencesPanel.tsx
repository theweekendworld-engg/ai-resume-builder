'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { splitList } from '@/components/scout/format';
import { updateUserPreferences } from '@/actions/profile';
import type { UserGenerationPreferences } from '@/lib/userPreferences';

/**
 * What Scout checks a job against.
 *
 * Every field is optional, and an empty field means "not stated", never
 * "anything goes": Scout asks when a job depends on something left blank, and
 * writes the answer back here. So this screen is where those answers can be
 * seen and corrected.
 *
 * Saves only the job-search keys. `updateUserPreferences` merges them over the
 * stored preferences, so resume defaults are untouched.
 */

export type JobSearchFields = Pick<
    UserGenerationPreferences,
    | 'targetRoles'
    | 'targetLocations'
    | 'preferredWorkModes'
    | 'willingToRelocate'
    | 'requiresSponsorship'
    | 'workAuthorization'
    | 'minCompensationText'
    | 'desiredCompensation'
    | 'companySizePreference'
    | 'noticePeriod'
>;

type Tri = UserGenerationPreferences['willingToRelocate'];
type WorkMode = UserGenerationPreferences['preferredWorkModes'][number];

const TRI_LABEL: Record<Tri, string> = {
    unknown: 'Not stated',
    yes: 'Yes',
    no: 'No',
    case_by_case: 'Case by case',
};

const SIZE_LABEL: Record<UserGenerationPreferences['companySizePreference'], string> = {
    any: 'Any size',
    startup: 'Startup (under ~200)',
    mid: 'Mid-size (~200–2,000)',
    large: 'Large (2,000+)',
};

const WORK_MODES: { value: WorkMode; label: string }[] = [
    { value: 'remote', label: 'Remote' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'onsite', label: 'Onsite' },
];

export function JobSearchPreferencesPanel({ initial }: { initial: JobSearchFields }) {
    const [roles, setRoles] = React.useState(initial.targetRoles.join(', '));
    const [locations, setLocations] = React.useState(initial.targetLocations.join(', '));
    const [modes, setModes] = React.useState<WorkMode[]>(initial.preferredWorkModes);
    const [relocate, setRelocate] = React.useState<Tri>(initial.willingToRelocate);
    const [sponsorship, setSponsorship] = React.useState<Tri>(initial.requiresSponsorship);
    const [authorization, setAuthorization] = React.useState(initial.workAuthorization);
    const [minComp, setMinComp] = React.useState(initial.minCompensationText);
    const [desiredComp, setDesiredComp] = React.useState(initial.desiredCompensation);
    const [size, setSize] = React.useState(initial.companySizePreference);
    const [notice, setNotice] = React.useState(initial.noticePeriod);
    const [busy, setBusy] = React.useState(false);

    const toggleMode = (mode: WorkMode, on: boolean) => {
        setModes((current) =>
            on ? WORK_MODES.map((entry) => entry.value).filter((value) => value === mode || current.includes(value)) : current.filter((value) => value !== mode),
        );
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        const result = await updateUserPreferences({
            targetRoles: splitList(roles),
            targetLocations: splitList(locations),
            preferredWorkModes: modes,
            willingToRelocate: relocate,
            requiresSponsorship: sponsorship,
            workAuthorization: authorization.trim(),
            minCompensationText: minComp.trim(),
            desiredCompensation: desiredComp.trim(),
            companySizePreference: size,
            noticePeriod: notice.trim(),
        });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'Could not save that.');
            return;
        }
        toast.success('Saved. Scout checks every new job against this.');
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">What you are looking for</CardTitle>
                <CardDescription>
                    Scout checks every job you share against this, and tells you plainly when a job conflicts with it. Leave a field
                    blank and Scout will ask when a job depends on it.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={save} className="space-y-5">
                    <div className="space-y-1.5">
                        <Label htmlFor="js-roles">Roles</Label>
                        <Input
                            id="js-roles"
                            value={roles}
                            onChange={(event) => setRoles(event.target.value)}
                            placeholder="Backend Engineer, SDE II"
                            maxLength={700}
                        />
                        <p className="text-xs text-muted-foreground">Comma-separated, up to 8.</p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="js-locations">Locations</Label>
                        <Input
                            id="js-locations"
                            value={locations}
                            onChange={(event) => setLocations(event.target.value)}
                            placeholder="Bengaluru, Remote India"
                            maxLength={700}
                        />
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium leading-none">Work mode</legend>
                        <div className="flex flex-wrap gap-4 pt-1">
                            {WORK_MODES.map((mode) => (
                                <label key={mode.value} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                        checked={modes.includes(mode.value)}
                                        onCheckedChange={(checked) => toggleMode(mode.value, checked === true)}
                                    />
                                    {mode.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="js-relocate">Open to relocating</Label>
                            <Select value={relocate} onValueChange={(value) => setRelocate(value as Tri)}>
                                <SelectTrigger id="js-relocate"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(TRI_LABEL) as Tri[]).map((value) => (
                                        <SelectItem key={value} value={value}>{TRI_LABEL[value]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="js-sponsorship">Needs visa sponsorship</Label>
                            <Select value={sponsorship} onValueChange={(value) => setSponsorship(value as Tri)}>
                                <SelectTrigger id="js-sponsorship"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(TRI_LABEL) as Tri[]).map((value) => (
                                        <SelectItem key={value} value={value}>{TRI_LABEL[value]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="js-auth">Work authorization</Label>
                        <Input
                            id="js-auth"
                            value={authorization}
                            onChange={(event) => setAuthorization(event.target.value)}
                            placeholder="Indian citizen · US H-1B · EU Blue Card"
                            maxLength={160}
                        />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="js-min-comp">Minimum pay</Label>
                            <Input
                                id="js-min-comp"
                                value={minComp}
                                onChange={(event) => setMinComp(event.target.value)}
                                placeholder="₹40 LPA · $180k base"
                                maxLength={120}
                            />
                            <p className="text-xs text-muted-foreground">As you would say it. Never converted.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="js-desired-comp">Target pay</Label>
                            <Input
                                id="js-desired-comp"
                                value={desiredComp}
                                onChange={(event) => setDesiredComp(event.target.value)}
                                placeholder="₹55–65 LPA"
                                maxLength={200}
                            />
                        </div>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="js-size">Company size</Label>
                            <Select value={size} onValueChange={(value) => setSize(value as typeof size)}>
                                <SelectTrigger id="js-size"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(SIZE_LABEL) as (typeof size)[]).map((value) => (
                                        <SelectItem key={value} value={value}>{SIZE_LABEL[value]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="js-notice">Notice period</Label>
                            <Input
                                id="js-notice"
                                value={notice}
                                onChange={(event) => setNotice(event.target.value)}
                                placeholder="60 days"
                                maxLength={120}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" size="sm" disabled={busy} className="gap-1.5">
                            {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
                            Save preferences
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
