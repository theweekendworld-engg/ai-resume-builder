'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

type LinkStatus = {
  success: boolean;
  configured?: boolean;
  linked?: boolean;
  identity?: { channel: string; externalId: string; verified: boolean } | null;
};

/** Mask all but the last four digits of a wa_id (a phone number). */
function maskNumber(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : value;
}

export function WhatsAppSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/channels/whatsapp/link')
      .then((res) => res.json())
      .then((data: LinkStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ success: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerateLink = async () => {
    setGenerating(true);
    setDeepLink(null);
    setToken(null);
    try {
      const res = await fetch('/api/channels/whatsapp/link', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
        setDeepLink(data.deepLink ?? null);
        toast.success('Link ready. Use it within 15 minutes.');
      } else {
        toast.error(data.error ?? 'Failed to generate link');
      }
    } catch {
      toast.error('Failed to generate link');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-32 rounded-xl" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </CardTitle>
        <CardDescription>
          {!status?.configured
            ? 'WhatsApp is not set up on this Patronus instance yet.'
            : status.linked
              ? `Linked to ${maskNumber(status.identity?.externalId ?? '')}`
              : 'Send job and post links from WhatsApp and get the analysis back in the chat.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status?.configured ? (
          <p className="text-sm text-muted-foreground">
            Telegram works today. WhatsApp needs a Meta Business number, which an administrator has to connect.
          </p>
        ) : status.linked ? (
          <p className="text-sm text-muted-foreground">
            Send any LinkedIn job or post link to the Patronus WhatsApp number to analyse it.
          </p>
        ) : (
          <>
            <Button onClick={handleGenerateLink} disabled={generating}>
              {generating ? 'Generating…' : 'Link WhatsApp'}
            </Button>
            {token && (
              <div className="space-y-2">
                {deepLink ? (
                  <a href={deepLink} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" className="w-full gap-2">
                      Open WhatsApp and send
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Or send <code className="font-mono">link {token}</code> to the Patronus WhatsApp number. Expires in 15 minutes.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
