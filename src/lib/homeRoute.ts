/**
 * Where a signed-in person lands: the first surface they can use, in the
 * product's order. Chat is the front door (docs/prd/10-chat.md); before it is
 * switched on, Goals; the resume dashboard is what every account has.
 *
 * One function so sign-in, sign-up, onboarding, the signed-in homepage and the
 * logo cannot disagree (launch audit 2026-10-02: four of them pointed at
 * /dashboard while the product had moved to chat).
 */
export function homeFor(_flags: { chat?: boolean; missions?: boolean } = {}): '/overview' {
    // Home is the overview for everyone (2026-10-04): one screen with every
    // section, whatever is switched on. Chat stays one click away, and the
    // overview's "Ask Patronus" box hands off to it.
    void _flags;
    return '/overview';
}
