'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

type LinkStatus = {
  success: boolean;
  linked?: boolean;
  identity?: { channel: string; externalId: string; verified: boolean } | null;
};

export function TelegramSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/channels/telegram/link');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ success: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleGenerateLink = async () => {
    setGenerating(true);
    setToken(null);
    setDeepLink(null);
    try {
      const res = await fetch('/api/channels/telegram/link', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
        setDeepLink(data.deepLink ?? null);
        toast.success('Link generated. Use it within 15 minutes.');
      } else {
        toast.error(data.error ?? 'Failed to generate link');
      }
    } catch {
      toast.error('Failed to generate link');
    } finally {
      setGenerating(false);
    }
  };

  const copyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success('Token copied');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Telegram Connect</h1>
          <p className="text-muted-foreground">Loading connection status...</p>
        </div>
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Telegram Connect</h1>
        <p className="text-muted-foreground">
          Link your Telegram account to generate resumes from the bot.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            {status?.linked
              ? `Linked as ${status.identity?.externalId ?? 'Telegram user'}`
              : 'Not linked. Generate a link token below.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status?.linked ? (
            <p className="text-sm text-muted-foreground">
              Send any job description to the bot to get a tailored resume.
            </p>
          ) : (
            <Button onClick={handleGenerateLink} disabled={generating}>
              {generating ? 'Generating…' : 'Generate Link Token'}
            </Button>
          )}
        </CardContent>
      </Card>

      {token && (
        <Card>
          <CardHeader>
            <CardTitle>Link steps</CardTitle>
            <CardDescription>Complete these steps to link your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border p-3">
              <span className="text-sm font-medium">1.</span>
              <span className="text-sm">Copy the token below.</span>
              <Button variant="outline" size="sm" onClick={copyToken}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border p-3">
              <Link2 className="h-4 w-4" />
              <span className="text-sm">2. Open the Telegram bot and send the token.</span>
              {deepLink && (
                <a href={deepLink} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">Open Bot</Button>
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono break-all">{token}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>Use the bot after linking.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Generate a link token above and open the Telegram bot.</p>
          <p>2. Send the token to the bot to link this account.</p>
          <p>3. Send any job description to the bot to receive a generated resume.</p>
        </CardContent>
      </Card>
    </div>
  );
}
