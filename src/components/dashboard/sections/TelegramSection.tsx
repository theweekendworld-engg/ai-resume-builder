'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { LINK_POLL_MS, linkStage, minutesLeft, shouldPollLink, telegramStartUrl } from '@/lib/channels/linkUi';

type LinkStatus = {
  success: boolean;
  linked?: boolean;
  identity?: { channel: string; externalId: string; verified: boolean } | null;
  /** The signed-in Patronus account, masked: "Jai · j•••@gmail.com". */
  account?: string | null;
  botUsername?: string | null;
};

type PendingLink = { token: string; deepLink: string | null; expiresAt: string };

/** Mask a Telegram chat id: enough to recognise, not to reuse. */
function maskChat(value: string): string {
  return value.length > 4 ? `•••${value.slice(-4)}` : value;
}

export function TelegramSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const wasLinked = useRef(false);

  const fetchStatus = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    try {
      const res = await fetch('/api/channels/telegram/link', { cache: 'no-store' });
      const data = (await res.json()) as LinkStatus;
      setStatus(data);
      if (data.linked && !wasLinked.current && opts.quiet) toast.success('Telegram linked.');
      wasLinked.current = Boolean(data.linked);
      if (data.linked) setPending(null);
    } catch {
      if (!opts.quiet) setStatus({ success: false });
    } finally {
      if (!opts.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const stage = linkStage({ linked: Boolean(status?.linked), tokenExpiresAt: pending?.expiresAt ?? null });

  // While a link is in flight, watch for it to land: every few seconds, and
  // the moment the user comes back from Telegram to this tab.
  useEffect(() => {
    if (!shouldPollLink(stage)) return;
    const timer = setInterval(() => void fetchStatus({ quiet: true }), LINK_POLL_MS);
    const onFocus = () => void fetchStatus({ quiet: true });
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [stage, fetchStatus]);

  const handleGenerateLink = async () => {
    setGenerating(true);
    setPending(null);
    try {
      const res = await fetch('/api/channels/telegram/link', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.token) {
        setPending({ token: data.token, deepLink: data.deepLink ?? null, expiresAt: data.expiresAt });
      } else {
        toast.error(data.error ?? 'Could not create a link');
      }
    } catch {
      toast.error('Could not create a link');
    } finally {
      setGenerating(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirmUnlink) {
      setConfirmUnlink(true);
      return;
    }
    setUnlinking(true);
    try {
      const res = await fetch('/api/channels/telegram/link', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Telegram unlinked. That chat no longer records to this account.');
        wasLinked.current = false;
        await fetchStatus();
      } else {
        toast.error(data.error ?? 'Could not unlink');
      }
    } catch {
      toast.error('Could not unlink');
    } finally {
      setUnlinking(false);
      setConfirmUnlink(false);
    }
  };

  const copyCommand = () => {
    if (!pending) return;
    void navigator.clipboard.writeText(`/start link_${pending.token}`);
    setCopied(true);
    toast.success('Command copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const botUsername = status?.botUsername ?? null;
  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
  const startUrl = pending ? telegramStartUrl({ deepLink: pending.deepLink, botUsername, token: pending.token }) : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Telegram</h1>
          <p className="text-muted-foreground">Loading connection status…</p>
        </div>
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Telegram</h1>
          <p className="text-muted-foreground">
            Send the bot a job link, a LinkedIn post, or a line about your work. It is recorded here.
          </p>
        </div>
        {botUrl ? (
          <a href={botUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              @{botUsername}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{status?.linked ? 'Linked' : 'Not linked'}</CardTitle>
          <CardDescription>
            {status?.linked
              ? `Chat ${maskChat(status.identity?.externalId ?? '')} records to ${status.account ?? 'this account'}.`
              : status?.account
                ? `Link a Telegram chat to ${status.account}.`
                : 'Link a Telegram chat to this account.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.linked ? (
            <div className="flex flex-wrap gap-2">
              {botUrl ? (
                <a href={botUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Link2 className="h-4 w-4" />
                    Open the bot
                  </Button>
                </a>
              ) : null}
              <Button variant="ghost" size="sm" className="gap-2" onClick={handleUnlink} disabled={unlinking}>
                <Unlink className="h-4 w-4" />
                {unlinking ? 'Unlinking…' : confirmUnlink ? 'Tap again to unlink' : 'Unlink'}
              </Button>
            </div>
          ) : stage === 'waiting' && pending ? (
            <div className="space-y-3">
              {startUrl ? (
                <a href={startUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button className="w-full gap-2">
                    <Link2 className="h-4 w-4" />
                    Open Telegram and link
                  </Button>
                </a>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Telegram opens with the bot. Tap <b>Start</b> there, and this page updates on its own.
                The link works for {minutesLeft(pending.expiresAt)} more minute{minutesLeft(pending.expiresAt) === 1 ? '' : 's'}.
              </p>
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">On a different device?</summary>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 break-all rounded border bg-muted px-3 py-2 font-mono text-xs">/start link_{pending.token}</code>
                  <Button variant="outline" size="icon" onClick={copyCommand} aria-label="Copy command">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2">Send this to {botUsername ? `@${botUsername}` : 'the bot'} in Telegram.</p>
              </details>
            </div>
          ) : (
            <div className="space-y-2">
              <Button onClick={handleGenerateLink} disabled={generating}>
                {generating ? 'Preparing…' : stage === 'expired' ? 'Link expired: get a new one' : 'Link Telegram'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the bot does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><b>A job link</b>: fit against your record, pay, company, interview write-ups, who to ask. Saved to your job tracker.</p>
          <p><b>A line about your work</b>: drafted into your Work Log for you to confirm.</p>
          <p><b>A post worth keeping</b>: saved to your Insights shelf.</p>
          <p><b>/jobs</b> best fits · <b>/applied</b> where things stand · <b>/notes</b> your drafts · <b>/generate</b> a tailored resume · <b>/help</b> everything.</p>
        </CardContent>
      </Card>
    </div>
  );
}
