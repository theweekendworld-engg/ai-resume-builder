import type { ReactNode } from 'react';
import { Briefcase, FileText, MessageSquare, Layers, Settings } from 'lucide-react';
import { useExtensionAuth } from '../hooks/useExtensionAuth';
import { cn } from '@/shared/ui/cn';
import type { RouteKey } from '../App';

const TABS: Array<{ key: RouteKey; label: string; icon: typeof Briefcase }> = [
    { key: 'apply', label: 'Apply', icon: Briefcase },
    { key: 'tailor', label: 'Tailor', icon: FileText },
    { key: 'answers', label: 'Answers', icon: MessageSquare },
    { key: 'workspaces', label: 'Workspaces', icon: Layers },
    { key: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({
    route,
    onRouteChange,
    children,
}: {
    route: RouteKey;
    onRouteChange: (k: RouteKey) => void;
    children: ReactNode;
}) {
    const auth = useExtensionAuth();

    return (
        <div className="flex h-screen flex-col">
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                        P
                    </div>
                    <span className="text-sm font-semibold">Patronus</span>
                </div>
                <AuthChip status={auth.status} email={auth.status === 'connected' ? auth.email : undefined} />
            </header>
            <nav className="flex border-b border-border bg-surface">
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onRouteChange(key)}
                        className={cn(
                            'flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium uppercase tracking-wide transition-colors',
                            route === key
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </nav>
            <main className="flex-1 overflow-y-auto p-3">{children}</main>
        </div>
    );
}

function AuthChip({ status, email }: { status: string; email?: string }) {
    if (status === 'connected') {
        return (
            <div className="chip border-success/40 bg-success/10 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {email ?? 'Connected'}
            </div>
        );
    }
    if (status === 'expired') {
        return (
            <div className="chip border-warning/40 bg-warning/10 text-warning">Expired</div>
        );
    }
    return (
        <div className="chip border-border bg-muted text-muted-foreground">
            Not connected
        </div>
    );
}
