import { jobStageFacts, jobStages } from '@/lib/jobStages';
import type { Overview } from '@/services/overview';

/**
 * A believable Home for `/dev/patterns/home` — the mocked screen the design
 * gallery renders, since authed pages cannot be signed into headlessly.
 * Dates are relative to `now` so the page never looks stale.
 */
export function overviewFixture(now = new Date(), state: 'active' | 'new' = 'active'): Overview {
    const day = 86_400_000;
    const at = (offsetDays: number, hour = 10) => {
        const date = new Date(now.getTime() + offsetDays * day);
        date.setHours(hour, 0, 0, 0);
        return date.toISOString();
    };
    if (state === 'new') {
        return {
            firstName: 'Jai',
            needsYou: [],
            pipeline: [
                { column: 'to_review', label: 'To review', count: 0, href: '/scout' },
                { column: 'applied', label: 'Applied', count: 0, href: '/scout' },
                { column: 'interviewing', label: 'Interviewing', count: 0, href: '/scout' },
                { column: 'offer', label: 'Offer', count: 0, href: '/scout' },
            ],
            upcoming: [],
            activity: [],
            record: { winsThisMonth: 0, confirmed: 0, drafts: 0 },
            goal: null,
            resumes: [],
            setup: [
                { key: 'resume', label: 'Add your resume or work history', done: false, href: '/dashboard?section=profile&tab=import' },
                { key: 'telegram', label: 'Link Telegram to log and share from your phone', done: false, href: '/settings/channels' },
                { key: 'email', label: 'Forward job email to Patronus', done: false, href: '/settings/email' },
                { key: 'calendar', label: 'Connect Google Calendar', done: false, href: '/settings/email' },
            ],
            jobs: [],
        };
    }
    const job = (id: string, role: string, company: string, fitScore: number, status: string, tailored: boolean, emailReady: boolean, offset: number) => ({
        id,
        role,
        company,
        href: '/scout',
        fitScore,
        stages: jobStages(jobStageFacts({ applicationStatus: status, fitScore, selectedResumeId: tailored ? 'r' : null, emailReady })),
        updatedAt: at(offset),
    });
    return {
        firstName: 'Jai',
        needsYou: [
            { key: 'i1', kind: 'interview', title: 'Plivo · technical interview', detail: 'Senior Backend Engineer at Plivo', href: '/scout', action: 'Prepare', at: at(2, 14) },
            { key: 'e1', kind: 'email', title: 'Reply to Priya Raman', detail: 'Asked for three slots next week for the onsite loop', href: '/scout?tab=email', action: 'Draft reply', at: at(-1) },
            { key: 'f1', kind: 'follow_up', title: 'Follow up on Staff Engineer, Media at Daily', detail: 'Applied 8 days ago, no reply yet', href: '/scout', action: 'Draft follow-up', at: at(-8) },
            { key: 'drafts', kind: 'drafts', title: '3 drafts in My work to confirm', detail: 'Confirmed wins are what your resumes are built from.', href: '/log', action: 'Review', at: null },
        ],
        pipeline: [
            { column: 'to_review', label: 'To review', count: 3, href: '/scout' },
            { column: 'applied', label: 'Applied', count: 5, href: '/scout' },
            { column: 'interviewing', label: 'Interviewing', count: 1, href: '/scout' },
            { column: 'offer', label: 'Offer', count: 0, href: '/scout' },
        ],
        upcoming: [
            { id: 'u1', title: 'Plivo · technical interview', job: 'Senior Backend Engineer at Plivo', at: at(2, 14), href: '/scout' },
            { id: 'u2', title: 'Daily · hiring manager call', job: 'Staff Engineer, Media at Daily', at: at(6, 11), href: '/scout' },
        ],
        activity: [
            { id: 'a1', kind: 'status_change', title: 'Moved to Interviewing', job: 'Senior Backend Engineer at Plivo', at: at(-1), href: '/scout' },
            { id: 'a2', kind: 'email', title: 'Recruiter replied', job: 'Senior Backend Engineer at Plivo', at: at(-1), href: '/scout' },
            { id: 'a3', kind: 'status_change', title: 'Applied', job: 'Platform Engineer at Linear', at: at(-3), href: '/scout' },
            { id: 'a4', kind: 'status_change', title: 'Applied', job: 'Staff Engineer, Media at Daily', at: at(-8), href: '/scout' },
        ],
        record: { winsThisMonth: 4, confirmed: 38, drafts: 3 },
        goal: { title: 'Staff engineer by mid-2027', percent: 40, nextStep: 'Write up the media-path latency work as a design doc' },
        resumes: [
            { id: 'r1', title: 'Backend · Plivo', target: 'Senior Backend Engineer at Plivo', updatedAt: at(-1) },
            { id: 'r2', title: 'Base resume', target: null, updatedAt: at(-12) },
        ],
        setup: [
            { key: 'resume', label: 'Add your resume or work history', done: true, href: '/dashboard?section=profile&tab=import' },
            { key: 'telegram', label: 'Link Telegram to log and share from your phone', done: true, href: '/settings/channels' },
            { key: 'email', label: 'Forward job email to Patronus', done: false, href: '/settings/email' },
            { key: 'calendar', label: 'Connect Google Calendar', done: false, href: '/settings/email' },
        ],
        jobs: [
            job('j1', 'Senior Backend Engineer', 'Plivo', 86, 'interview', true, true, -1),
            job('j2', 'Platform Engineer', 'Linear', 78, 'analyzed', true, true, -2),
            job('j3', 'Staff Engineer, Media', 'Daily', 81, 'analyzed', true, false, -4),
            job('j4', 'Backend Engineer, Payments', 'Razorpay', 64, 'analyzed', false, false, -5),
        ],
    };
}
