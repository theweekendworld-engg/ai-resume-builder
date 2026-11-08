import { Globe, Send, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * Where you talk to it. One assistant and one record behind every surface:
 * a note sent from Telegram on the train is in the web chat when you sit down.
 *
 * Only surfaces a new user can use today are marked live. The CLI is built
 * (`cli/`) but not published to npm, so it says so.
 *
 * A sunken band, so the three contained sections around it do not scroll as
 * one (see the rhythm note in `(marketing)/page.tsx`).
 */
const CHANNELS = [
    {
        icon: Globe,
        title: 'On the web',
        body: 'The chat is the front door. Paste a job, log a win, ask what you shipped last quarter. Your Work Log, jobs and resumes are one click away.',
        status: 'Live',
    },
    {
        icon: Send,
        title: 'On Telegram',
        body: 'Link it once from Settings. Send a job link or a line about your day from your phone, and it lands in the same record.',
        status: 'Live',
    },
    {
        icon: Terminal,
        title: 'In your terminal',
        body: 'A small CLI with a personal key. Log the fix you just pushed without leaving the shell.',
        status: 'Coming soon',
    },
] as const;

export function Channels() {
    return (
        <Section id="channels" tone="sunken">
            <SectionIntro
                eyebrow="Wherever you are"
                title={
                    <>
                        One assistant. <span className="mk-quiet">Every place you work.</span>
                    </>
                }
                lead="Something worth remembering happens at your desk, in a meeting, or on the way home. Tell Patronus where you are, and it is in your record everywhere."
            />

            <div className="mt-16 grid gap-6 md:grid-cols-3">
                {CHANNELS.map((channel, index) => {
                    const Icon = channel.icon;
                    const live = channel.status === 'Live';
                    return (
                        <Reveal key={channel.title} delay={index * 120} className="mk-card p-7">
                            <div className="flex items-center justify-between">
                                <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                                {/* A quiet status, the app's Pill: colour on the dot only. */}
                                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[11.5px] font-medium text-foreground">
                                    <span aria-hidden className={cn('size-1.5 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/50')} />
                                    {channel.status}
                                </span>
                            </div>
                            <h3 className="mt-6 font-display text-xl font-semibold leading-snug tracking-[-0.01em]">{channel.title}</h3>
                            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{channel.body}</p>
                        </Reveal>
                    );
                })}
            </div>
        </Section>
    );
}
