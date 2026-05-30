import type { Message, Response } from '@/shared/types/messages';

type HandlerMap = {
    [K in Message['type']]?: (
        msg: Extract<Message, { type: K }>,
        sender: chrome.runtime.MessageSender
    ) => Promise<Response<unknown>> | Response<unknown>;
};

const handlers: HandlerMap = {};

export function on<T extends Message['type']>(
    type: T,
    handler: (
        msg: Extract<Message, { type: T }>,
        sender: chrome.runtime.MessageSender
    ) => Promise<Response<unknown>> | Response<unknown>
): void {
    // @ts-expect-error keyed indexing across the discriminated union is fine at runtime.
    handlers[type] = handler;
}

function isMessage(value: unknown): value is Message {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        typeof (value as { type: unknown }).type === 'string'
    );
}

// Single chrome.runtime.onMessage listener owns dispatch. Each registered
// handler returns a typed Response<T>; we keep the channel open until the
// promise resolves so async handlers work.
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (!isMessage(raw)) {
        sendResponse({ ok: false, error: 'invalid_message' } satisfies Response<never>);
        return false;
    }
    const handler = handlers[raw.type as Message['type']];
    if (!handler) {
        sendResponse({ ok: false, error: `no_handler:${raw.type}` } satisfies Response<never>);
        return false;
    }
    // @ts-expect-error the discriminated union narrows at runtime; TS can't see it.
    Promise.resolve(handler(raw, sender))
        .then((res) => sendResponse(res))
        .catch((err: unknown) => {
            const error = err instanceof Error ? err.message : 'handler_error';
            sendResponse({ ok: false, error } satisfies Response<never>);
        });
    return true; // keep the channel open for async sendResponse
});

// Caller helper used from side panel / popup.
export async function request<T = unknown>(msg: Message): Promise<Response<T>> {
    try {
        const res = (await chrome.runtime.sendMessage(msg)) as Response<T> | undefined;
        if (!res) return { ok: false, error: 'no_response' };
        return res;
    } catch (err) {
        const error = err instanceof Error ? err.message : 'send_message_error';
        return { ok: false, error };
    }
}
