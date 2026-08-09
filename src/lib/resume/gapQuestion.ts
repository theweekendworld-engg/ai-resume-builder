/**
 * The question we put to a candidate about an unanswered requirement.
 *
 * Lives in a plain module rather than beside the action that uses it, because
 * `'use server'` files may export ONLY async functions — a pure helper there
 * type-checks fine and fails `next build`, which is how this rule has bitten
 * this codebase four times now.
 *
 * ── Why it asks for a story ─────────────────────────────────────────────────
 *
 * "Do you have experience with Kubernetes?" invites a yes, and the product
 * cannot use a yes. Asking for one occasion — situation, action, outcome — is
 * what produces something that can become a Win, and a Win is the only thing
 * the next resume can draw on.
 */
export function questionForRequirement(requirement: string): string {
    const text = requirement.trim().replace(/\.$/, '');
    return `Think of one time you did this: “${text}”. What was the situation, what did you do, and what changed because of it?`;
}
