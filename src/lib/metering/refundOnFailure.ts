import { refundMeteredAction, type MeteredAction } from '@/lib/entitlements';

/**
 * Run work that a metered unit was already taken for; if it throws, give the
 * unit back, then rethrow. The user got nothing, so they paid nothing
 * (PRD 06 §8). One helper so every "charged before the work started" path
 * refunds the same way — packets did not refund a failed workflow start.
 */
export async function withRefundOnFailure<T>(
    params: { userId: string; action: MeteredAction; reason: string },
    work: () => Promise<T>,
): Promise<T> {
    try {
        return await work();
    } catch (error) {
        await refundMeteredAction(params.userId, params.action, { reason: params.reason }).catch((refundError: unknown) => {
            console.error('[metering] refund after failure did not go through', {
                action: params.action,
                reason: params.reason,
                error: String(refundError),
            });
        });
        throw error;
    }
}
