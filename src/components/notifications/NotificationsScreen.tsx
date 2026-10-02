'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    updateNotificationSettings,
    type NotificationSettings,
    type NotificationSettingsPatch,
} from '@/actions/digest';

/**
 * `/settings/notifications` — design/02 §J2.
 *
 * Channel, day + hour with a live preview line, per-category toggles, and one
 * unsubscribe-all. Every control writes immediately and optimistically: this is
 * a preferences page, and a Save button on a preferences page is a way to lose
 * someone's choice.
 *
 * The preview line matters more than it looks. "Next digest: Friday, Aug 7 at
 * 4:00 PM" is the only place the user can verify that a timezone we guessed
 * from their browser is the one they actually work in.
 */

const DAYS: Array<{ value: string; label: string }> = [
    { value: '1', label: 'Monday' },
    { value: '2', label: 'Tuesday' },
    { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' },
    { value: '5', label: 'Friday' },
    { value: '6', label: 'Saturday' },
    { value: '7', label: 'Sunday' },
];

function hourLabel(hour: number): string {
    const h = hour % 12 === 0 ? 12 : hour % 12;
    return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }));

type CategoryKey = 'weeklyDigest' | 'monthlyReview' | 'radarDigest' | 'missionNudges' | 'productUpdates';

const CATEGORIES: Array<{ key: CategoryKey; title: string; description: string }> = [
    {
        key: 'weeklyDigest',
        title: 'Weekly digest',
        description: 'The Friday review. Confirm the week in about twenty seconds.',
    },
    {
        key: 'monthlyReview',
        title: 'Month in Review',
        description: 'What the month added up to, written from the wins you confirmed.',
    },
    {
        key: 'radarDigest',
        title: 'Career radar',
        description: 'Market signal on your title, and where your evidence is thin.',
    },
    {
        key: 'missionNudges',
        title: 'Mission nudges',
        description: 'Reminders when something you started is going stale.',
    },
    {
        key: 'productUpdates',
        title: 'Product updates',
        description: 'Occasional. New capture sources, new surfaces.',
    },
];

export function NotificationsScreen({ initial, emailOn = true }: { initial: NotificationSettings; emailOn?: boolean }) {
    const [settings, setSettings] = useState(initial);
    const [pending, startTransition] = useTransition();

    function apply(patch: NotificationSettingsPatch, optimistic: Partial<NotificationSettings>): void {
        const previous = settings;
        setSettings({ ...settings, ...optimistic });
        startTransition(async () => {
            const result = await updateNotificationSettings(patch);
            if (!result.success) {
                setSettings(previous);
                toast.error(result.error);
                return;
            }
            setSettings(result.data);
        });
    }

    const digestOff = !settings.weeklyDigest || settings.unsubscribedAll;

    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    When we check in, and how.
                </p>
            </header>

            {/* Said plainly rather than letting the next-digest time imply a
                send that will not happen (audit 2026-10-02). */}
            {!emailOn ? (
                <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    Email is not available yet, so nothing is sent by email.{' '}
                    {settings.telegramLinked ? 'Choose Telegram below to get your weekly ritual there.' : 'Link Telegram to get your weekly ritual in the chat.'}
                </p>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">The weekly ritual</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="digest-channel">Where it arrives</Label>
                        <Select
                            value={settings.digestChannel}
                            onValueChange={(value) =>
                                apply(
                                    { digestChannel: value as 'email' | 'telegram' },
                                    { digestChannel: value as 'email' | 'telegram' },
                                )
                            }
                        >
                            <SelectTrigger id="digest-channel" className="w-full sm:w-64">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="telegram" disabled={!settings.telegramLinked}>
                                    Telegram{settings.telegramLinked ? '' : ' — not linked yet'}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {settings.telegramLinked ? (
                            <p className="text-xs text-muted-foreground">
                                Telegram confirms in the chat itself — no page to open. It is the faster of the two.
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                <a href="/dashboard?section=telegram" className="underline">Link Telegram</a> to confirm wins without leaving the chat.
                            </p>
                        )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="digest-day">Day</Label>
                            <Select
                                value={String(settings.digestDay)}
                                onValueChange={(value) =>
                                    apply({ digestDay: Number(value) }, { digestDay: Number(value) })
                                }
                            >
                                <SelectTrigger id="digest-day">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DAYS.map((day) => (
                                        <SelectItem key={day.value} value={day.value}>
                                            {day.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="digest-hour">Time</Label>
                            <Select
                                value={String(settings.digestHour)}
                                onValueChange={(value) =>
                                    apply({ digestHour: Number(value) }, { digestHour: Number(value) })
                                }
                            >
                                <SelectTrigger id="digest-hour">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {HOURS.map((hour) => (
                                        <SelectItem key={hour.value} value={hour.value}>
                                            {hour.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <p className="rounded-md bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
                        {digestOff ? (
                            <span className="text-muted-foreground">
                                The weekly digest is off. Capture keeps running — nothing stops being recorded.
                            </span>
                        ) : (
                            <>
                                <span className="text-muted-foreground">Next digest: </span>
                                <span className="font-medium">{settings.nextDigestLabel}</span>
                                <span className="text-muted-foreground"> ({settings.timezone})</span>
                            </>
                        )}
                    </p>
                    <TimezoneFixer
                        current={settings.timezone}
                        pending={pending}
                        onFix={(timezone) => apply({ timezone }, { timezone })}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">What we send</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {CATEGORIES.map((category) => (
                        <div key={category.key} className="flex items-start justify-between gap-6">
                            <div>
                                <Label htmlFor={`cat-${category.key}`} className="text-sm font-medium">
                                    {category.title}
                                </Label>
                                <p className="mt-0.5 text-xs text-muted-foreground">{category.description}</p>
                            </div>
                            <Switch
                                id={`cat-${category.key}`}
                                checked={settings[category.key] && !settings.unsubscribedAll}
                                disabled={settings.unsubscribedAll || pending}
                                onCheckedChange={(checked) =>
                                    apply({ [category.key]: checked }, { [category.key]: checked })
                                }
                            />
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Everything off</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {settings.unsubscribedAll
                            ? 'You are unsubscribed from all email. Your log is untouched and still capturing — turn it back on whenever you like.'
                            : 'Stops every non-essential email. Your log keeps capturing and nothing is deleted; sign-in links still arrive.'}
                    </p>
                    <Button
                        variant={settings.unsubscribedAll ? 'default' : 'outline'}
                        disabled={pending}
                        onClick={() =>
                            apply(
                                { unsubscribedAll: !settings.unsubscribedAll },
                                { unsubscribedAll: !settings.unsubscribedAll },
                            )
                        }
                    >
                        {settings.unsubscribedAll ? 'Resubscribe' : 'Unsubscribe from everything'}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * The timezone is guessed once from the browser and then never revisited, which
 * is wrong for anyone who moves. Offering the fix only when the guess disagrees
 * with the stored value keeps it out of the way the other 99% of the time.
 */
function TimezoneFixer({
    current,
    pending,
    onFix,
}: {
    current: string;
    pending: boolean;
    onFix: (timezone: string) => void;
}) {
    const [detected] = useState(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch {
            return '';
        }
    });

    if (!detected || detected === current) return null;

    return (
        <p className="text-xs text-muted-foreground">
            This device says you are in {detected}.{' '}
            <button
                type="button"
                disabled={pending}
                onClick={() => onFix(detected)}
                className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
            >
                Use that instead
            </button>
        </p>
    );
}
