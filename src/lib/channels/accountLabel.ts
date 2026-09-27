/**
 * How a Patronus account is named in chat, without leaking the address.
 *
 * "This Telegram is linked to another Patronus account (a•••@gmail.com)" is
 * enough for the owner of two accounts to recognise which one, and useless to
 * anyone else who happens to hold the chat.
 */

export function maskEmail(email: string | null | undefined): string | null {
    const value = (email ?? '').trim();
    const at = value.indexOf('@');
    if (at < 1) return null;
    return `${value[0]}•••${value.slice(at)}`;
}

export function accountLabel(profile: { fullName?: string | null; email?: string | null } | null): string {
    const masked = maskEmail(profile?.email);
    const name = profile?.fullName?.trim();
    if (name && masked) return `${name} · ${masked}`;
    return masked ?? name ?? 'another account';
}
