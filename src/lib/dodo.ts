import DodoPayments from 'dodopayments';
import { dodoApiKey, dodoEnvironment } from '@/lib/billing/provider';

type Customer = DodoPayments.Customer;
type CustomerCreateParams = DodoPayments.CustomerCreateParams;
type CustomerPortalSession = DodoPayments.CustomerPortalSession;
type CustomerPortalCreateParams = DodoPayments.Customers.CustomerPortalCreateParams;
type CheckoutSessionCreateParams = DodoPayments.CheckoutSessionCreateParams;
type CheckoutSessionResponse = DodoPayments.CheckoutSessionResponse;
type CheckoutSessionStatus = DodoPayments.CheckoutSessionStatus;
type Payment = DodoPayments.Payment;
type PaymentListParams = DodoPayments.PaymentListParams;
type PaymentListResponse = DodoPayments.PaymentListResponse;
type Refund = DodoPayments.Refund;
type RefundCreateParams = DodoPayments.RefundCreateParams;
type Subscription = DodoPayments.Subscription;
type SubscriptionUpdateParams = DodoPayments.SubscriptionUpdateParams;

/**
 * Dodo Payments client (docs/impl/09-payments-dodo.md). **Server only**: the
 * key lives in a non-public env var, so a client bundle importing this gets a
 * client that cannot authenticate, and nothing here is reachable from a
 * client component in the first place.
 *
 * {@link DodoClient} is the slice of the SDK this app calls, written as plain
 * `Promise`s of the SDK's own types. The real client is assigned to it in
 * {@link getDodo}, so an SDK upgrade that changes one of these signatures
 * fails the type-check here rather than at a customer's checkout; the test
 * double (`src/__mocks__/dodo.ts`) implements the same interface without a cast.
 */
export interface DodoClient {
    customers: {
        create(body: CustomerCreateParams): Promise<Customer>;
        customerPortal: {
            create(customerId: string, params?: CustomerPortalCreateParams): Promise<CustomerPortalSession>;
        };
    };
    checkoutSessions: {
        create(body: CheckoutSessionCreateParams): Promise<CheckoutSessionResponse>;
        retrieve(id: string): Promise<CheckoutSessionStatus>;
    };
    subscriptions: {
        retrieve(id: string): Promise<Subscription>;
        update(id: string, body: SubscriptionUpdateParams): Promise<Subscription>;
    };
    payments: {
        retrieve(id: string): Promise<Payment>;
        list(params: PaymentListParams): Promise<{ items: PaymentListResponse[] }>;
    };
    refunds: {
        create(body: RefundCreateParams): Promise<Refund>;
    };
}

export type DodoSubscription = DodoPayments.Subscription;
export type DodoSubscriptionStatus = DodoPayments.SubscriptionStatus;

let client: DodoClient | null = null;

export function getDodo(): DodoClient {
    if (client) return client;
    const bearerToken = dodoApiKey();
    if (!bearerToken) {
        throw new Error('Dodo Payments is not configured (missing DODO_PAYMENTS_API_KEY)');
    }
    const real: DodoClient = new DodoPayments({
        bearerToken,
        // Never the SDK default (live): test mode unless live is named exactly.
        environment: dodoEnvironment(),
        // Signature checks happen in the webhook route with `standardwebhooks`
        // directly; the client is never asked to unwrap.
        webhookKey: null,
    });
    client = real;
    return client;
}

/** Test seam: swap the client for a double. Never call this from app code. */
export function __setDodoClientForTests(stub: DodoClient | null): void {
    client = stub;
}
