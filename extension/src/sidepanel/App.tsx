import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { ApplyRoute } from './routes/ApplyRoute';
import { TailorRoute } from './routes/TailorRoute';
import { AnswersRoute } from './routes/AnswersRoute';
import { WorkspacesRoute } from './routes/WorkspacesRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import { trackExtensionEvent } from '@/shared/lib/telemetry';
import { SendToPatronus } from '@/shared/ui/SendToPatronus';

export type RouteKey = 'apply' | 'tailor' | 'answers' | 'workspaces' | 'settings';

export function App() {
    const [route, setRoute] = useState<RouteKey>('apply');

    useEffect(() => {
        trackExtensionEvent('sidepanel.opened', {});
    }, []);

    const handleRouteChange = (next: RouteKey) => {
        if (next !== route) {
            trackExtensionEvent('sidepanel.route', { route: next });
        }
        setRoute(next);
    };

    return (
        <AppShell route={route} onRouteChange={handleRouteChange}>
            {route === 'apply' && (
                <div className="space-y-3">
                    {/* Above the apply flow, because it works on pages the
                        apply flow does not: a LinkedIn post has no form. */}
                    <SendToPatronus />
                    <ApplyRoute />
                </div>
            )}
            {route === 'tailor' && <TailorRoute />}
            {route === 'answers' && <AnswersRoute />}
            {route === 'workspaces' && <WorkspacesRoute />}
            {route === 'settings' && <SettingsRoute />}
        </AppShell>
    );
}
