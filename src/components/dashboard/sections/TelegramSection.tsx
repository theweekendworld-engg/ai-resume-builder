'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, Link2, ExternalLink } from 'lucide-react';
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
    try {
      const res = await fetch('/api/channels/telegram/link', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
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
      navigator.clipboard.writeText(`/start link_${token}`);
      setCopied(true);
      toast.success('Command copied');
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Telegram Connect</h1>
          <p className="text-muted-foreground">
            Link your Telegram account to generate resumes from the bot.
          </p>
        </div>
        <a href="https://t.me/Patronus_resume_bot" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
            @Patronus_resume_bot
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
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
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Send any job description to the bot to get a tailored resume.
              </p>
              <a href="https://t.me/Patronus_resume_bot" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <Link2 className="h-4 w-4" />
                  Open Bot
                </Button>
              </a>
            </div>
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
            <CardTitle>Link your account</CardTitle>
            <CardDescription>Copy the command below and send it to the bot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono break-all rounded bg-muted px-3 py-2 border">
                /start link_{token}
              </code>
              <Button variant="outline" size="icon" onClick={copyToken}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <a href="https://t.me/Patronus_resume_bot" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full gap-2">
                <Link2 className="h-4 w-4" />
                Open Telegram Bot
              </Button>
            </a>
            <p className="text-xs text-muted-foreground">
              Copy the command above, open the bot, and paste it in the chat. Expires in 15 minutes.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>Use the bot after linking.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Click &ldquo;Generate Link Token&rdquo; above and copy the command.</p>
          <p>2. Open the bot and paste the command to link your account.</p>
          <p>3. Paste any job description to the bot to receive a tailored resume.</p>
          <p>4. The bot may ask a few clarifying questions before generating.</p>
          <p>5. Use /status anytime to check progress, or /profile to update your info.</p>
        </CardContent>
      </Card>
    </div>
  );
}
