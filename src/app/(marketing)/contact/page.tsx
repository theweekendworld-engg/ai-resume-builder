// TODO(owner): review this page before submitting the site for payment-gateway
// (Razorpay) review. Confirm the operator name, location and support address.
import { CONTACT_EMAIL } from '@/components/marketing/Contact';
import { LegalPage, LegalSection } from '@/components/marketing/LegalPage';

export const metadata = {
    title: 'Contact · Patronus',
    description: 'How to reach the person who runs Patronus.',
};

export default function ContactPage() {
    return (
        <LegalPage title="Contact us">
            <LegalSection heading="Email">
                <p>
                    Write to{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                        {CONTACT_EMAIL}
                    </a>
                    . A person reads every message, and you can expect a reply within 2 business days.
                </p>
            </LegalSection>
            <LegalSection heading="What to write about">
                <p>
                    Billing and refunds, deleting your data, a bug, or whether the free plan already covers
                    what you need. For a billing question, include the email address you signed up with.
                </p>
            </LegalSection>
            <LegalSection heading="Who runs Patronus">
                <p>Patronus is operated by Jai Shankar, an individual based in India.</p>
            </LegalSection>
        </LegalPage>
    );
}
