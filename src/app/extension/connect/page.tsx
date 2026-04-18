import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { approveExtensionConnectGrant } from '@/lib/extension/connect';

type ExtensionConnectPageProps = {
  searchParams: Promise<{
    grantId?: string;
  }>;
};

function ConnectShell({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <section className="mx-auto flex max-w-xl flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Patronus Extension</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-base leading-7 text-muted-foreground">{message}</p>
      </section>
    </main>
  );
}

export default async function ExtensionConnectPage({ searchParams }: ExtensionConnectPageProps) {
  const params = await searchParams;
  const grantId = typeof params.grantId === 'string' ? params.grantId.trim() : '';

  if (!grantId) {
    return (
      <ConnectShell
        title="Connection link is missing"
        message="Start the connection again from the browser extension."
      />
    );
  }

  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/extension/connect?grantId=${grantId}`)}`);
  }

  const result = await approveExtensionConnectGrant(grantId, userId);

  if (result.status === 'not_found') {
    return (
      <ConnectShell
        title="Connection link was not found"
        message="Start a fresh connection from the browser extension."
      />
    );
  }

  if (result.status === 'expired') {
    return (
      <ConnectShell
        title="Connection link expired"
        message="Return to the browser extension and start a new connection."
      />
    );
  }

  if (result.status === 'already_connected') {
    return (
      <ConnectShell
        title="Extension already connected"
        message="You can close this tab and return to the browser extension."
      />
    );
  }

  if (result.status === 'approved_by_other_account') {
    return (
      <ConnectShell
        title="Connection already approved"
        message="Start a fresh connection from the browser extension while signed in with this account."
      />
    );
  }

  return (
    <ConnectShell
      title="Extension connected"
      message="You can close this tab and return to the browser extension."
    />
  );
}
