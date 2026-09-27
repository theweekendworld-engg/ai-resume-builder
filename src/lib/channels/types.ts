/**
 * Channel-neutral message model and adapter contract.
 *
 * Scout's renderers produce a `RichMessage` — lines of segments plus actions —
 * and never a channel's markup. Each channel formats it (Telegram HTML,
 * WhatsApp's own `*bold*`), escapes it, and enforces its own limits. That is
 * the only way escaping lives in one place per channel instead of at every
 * string concatenation, which is where Telegram "can't parse entities" errors
 * come from.
 */

export type Segment = {
    text: string;
    bold?: boolean;
    italic?: boolean;
    /** Rendered as a link on channels that support one, else as "text: url". */
    href?: string;
};

export type Line = Segment[];

export type ScoutAction =
    | { kind: 'answer'; index: number; label: string }
    | { kind: 'draft'; target: DraftTargetCode; format: DraftFormatCode; label: string }
    | { kind: 'why'; label: string }
    | { kind: 'refresh'; label: string }
    /** Move the run's job along the tracker (Save / Applied / …). */
    | { kind: 'status'; status: JobStatusCode; label: string }
    /**
     * Confirm or dismiss a Work Log draft. Keyed by the WIN, not the run: the
     * `/notes` list offers these for Wins that no longer have a run in view.
     */
    | { kind: 'confirm_win'; winId: string; label: string }
    | { kind: 'dismiss_win'; winId: string; label: string }
    /** Tailor a resume for the run's job, from the JD Scout already stored. */
    | { kind: 'tailor'; label: string }
    /** A plain link. Telegram renders a URL button; WhatsApp puts it in the text. */
    | { kind: 'open'; label: string; url: string };

/** Single-letter codes: Telegram's callback_data is capped at 64 bytes. */
export type DraftTargetCode = 'p' | 'r' | 'h' | 'f' | 'a';
export type DraftFormatCode = 'n' | 'm' | 'e';
/** saved · applied · interviewing · offer · rejected · not_interested */
export type JobStatusCode = 's' | 'a' | 'i' | 'o' | 'r' | 'n';

export type RichMessage = {
    lines: Line[];
    /** Always kept, even when `lines` must be truncated to fit the limit. */
    footer?: Line;
    actions: ScoutAction[];
};

export type ChannelButton =
    | { kind: 'callback'; label: string; data: string }
    | { kind: 'url'; label: string; url: string };

/** A message after channel formatting, ready for the wire. */
export type FormattedMessage = {
    text: string;
    buttons: ChannelButton[];
};

export type ChannelLimits = {
    maxText: number;
    maxButtons: number;
    maxButtonLabel: number;
};

export interface ChannelAdapter {
    readonly channel: 'telegram' | 'whatsapp';
    readonly limits: ChannelLimits;
    format(message: RichMessage, runId: string): FormattedMessage;
    send(to: string, message: FormattedMessage): Promise<{ ok: boolean; messageId: string | null }>;
    /** Absent on channels that cannot edit a sent message (WhatsApp). */
    edit?(to: string, messageId: string, message: FormattedMessage): Promise<boolean>;
}
