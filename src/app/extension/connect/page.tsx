import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { approveExtensionConnect } from '@/actions/extensionConnect';
import { readExtensionConnectGrant } from '@/lib/extension/connect';

type ExtensionConnectPageProps = {
  searchParams: Promise<{ grantId?: string; result?: string }>;
};

function ConnectShell({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Patronus Extension</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-base leading-7 text-muted-foreground">{message}</p>
        {children}
      </section>
    </main>
  );
}

const DONE: Record<string, { title: string; message: string }> = {
  approved: { title: 'Extension connected', message: 'You can close this tab and return to the browser extension.' },
  already_approved: { title: 'Extension connected', message: 'You can close this tab and return to the browser extension.' },
  approved_by_you: { title: 'Extension connected', message: 'You can close this tab and return to the browser extension.' },
  already_connected: { title: 'Extension already connected', message: 'You can close this tab and return to the browser extension.' },
  not_found: { title: 'Connection link was not found', message: 'Start a fresh connection from the browser extension.' },
  expired: { title: 'Connection link expired', message: 'Return to the browser extension and start a new connection.' },
  approved_by_other_account: {
    title: 'Connection already approved',
    message: 'Start a fresh connection from the browser extension while signed in with this account.',
  },
};

/**
 * Shows the request and asks. Rendering this page changes nothing: approval is
 * the button, which runs `approveExtensionConnect` for the signed-in user.
 */
export default async function ExtensionConnectPage({ searchParams }: ExtensionConnectPageProps) {
  const params = await searchParams;
  const grantId = typeof params.grantId === 'string' ? params.grantId.trim() : '';

  if (!grantId) {
    return <ConnectShell title="Connection link is missing" message="Start the connection again from the browser extension." />;
  }

  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/extension/connect?grantId=${grantId}`)}`);
  }

  const state = await readExtensionConnectGrant(grantId, userId);
  if (state !== 'pending') {
    const done = DONE[state] ?? DONE.not_found;
    return <ConnectShell title={done.title} message={done.message} />;
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? 'your account';
  return (
    <ConnectShell
      title="Connect the browser extension?"
      message={`This lets the Patronus extension read and fill job applications using ${email}. Only continue if you just clicked "Connect" in the extension yourself.`}
    >
      <form action={approveExtensionConnect} className="flex gap-3">
        <input type="hidden" name="grantId" value={grantId} />
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Connect
        </button>
        <a href="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm">
          Cancel
        </a>
      </form>
    </ConnectShell>
  );
}
