import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useProfile } from '../hooks/useProfile';

export function ProfileCompletenessBanner({ appBase }: { appBase: string }) {
    const profile = useProfile();

    if (profile.status !== 'ready') return null;
    if (profile.data.completeness.complete) return null;

    const missing = profile.data.completeness.missing.slice(0, 4).join(', ');

    return (
        <div className="card flex items-start gap-2 border-warning/40 bg-warning/5 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <div className="flex-1">
                <p className="font-medium text-foreground">Finish your profile to enable autofill</p>
                <p className="mt-0.5 text-muted-foreground">Missing: {missing}</p>
                <button
                    type="button"
                    onClick={() => {
                        chrome.tabs.create({ url: `${appBase}/dashboard?section=profile` });
                    }}
                    className="btn-outline mt-2 text-xs"
                >
                    Complete profile
                    <ExternalLink className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

export function useProfileCompleteness() {
    const profile = useProfile();
    if (profile.status !== 'ready') return { complete: true, ready: false };
    return { complete: profile.data.completeness.complete, ready: true };
}
