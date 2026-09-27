// TODO(owner): review this policy before submitting the site for payment-gateway
// (Razorpay) review, and again before paid plans go on sale. It is written to
// be fair and plain, not as legal advice.
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/components/marketing/Contact';
import { LegalPage, LegalSection } from '@/components/marketing/LegalPage';

export const metadata = {
    title: 'Refunds & cancellation · Patronus',
    description: 'How cancelling a Patronus subscription works, and when you get your money back.',
};

export default function RefundPolicyPage() {
    return (
        <LegalPage title="Refund and cancellation policy">
            <LegalSection heading="What you are buying">
                <p>
                    Patronus is an online software service. Paid plans are monthly subscriptions that unlock more of
                    it; the prices are listed on the <Link href="/pricing" className="underline-offset-4 hover:underline">pricing page</Link>.
                    The free plan costs nothing and needs no payment details. Paid plans are not on sale yet; this
                    policy applies from the day they are.
                </p>
            </LegalSection>
            <LegalSection heading="Cancelling">
                <p>
                    You can cancel any time from your plan settings, or by emailing us. Cancelling stops the next
                    renewal. You keep the paid features until the end of the period you have already paid for,
                    and then your account returns to the free plan.
                </p>
                <p>Nothing you recorded is deleted when you cancel or downgrade — it is kept, and visible again if you return.</p>
            </LegalSection>
            <LegalSection heading="Refunds">
                <p>
                    If you are charged and change your mind, email us within 7 days of the charge for a full
                    refund of that charge. If the service does not work as described, or you were charged in
                    error or twice, you get a full refund regardless of timing.
                </p>
                <p>
                    Approved refunds are returned to the original payment method. Once issued, they usually
                    appear within 5–7 business days, depending on your bank.
                </p>
            </LegalSection>
            <LegalSection heading="How to ask">
                <p>
                    Email{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                        {CONTACT_EMAIL}
                    </a>{' '}
                    from the address you signed up with, and say which charge. We reply within 2 business days.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
