// TODO(owner): review this page before submitting the site for payment-gateway
// (Razorpay) review.
import { LegalPage, LegalSection } from '@/components/marketing/LegalPage';

export const metadata = {
    title: 'Delivery · Patronus',
    description: 'Patronus is a digital service. Nothing is shipped.',
};

export default function ShippingPolicyPage() {
    return (
        <LegalPage title="Shipping and delivery policy">
            <LegalSection heading="Digital service, delivered online">
                <p>
                    Patronus is an online software service. There are no physical goods and nothing is shipped.
                </p>
                <p>
                    Access is delivered instantly: the free plan is available as soon as you create an account,
                    and a paid plan&apos;s features are unlocked on your account as soon as the payment is confirmed.
                    Everything is used through the website at this address, from any device with a browser.
                </p>
            </LegalSection>
            <LegalSection heading="If access does not appear">
                <p>
                    If a payment goes through and the features do not unlock within a few minutes, contact us
                    and we will fix it or refund the charge.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
