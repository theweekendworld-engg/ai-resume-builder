// TODO(owner): review these terms before submitting the site for payment-gateway
// (Razorpay) review and before paid plans go on sale. Written plainly; it is not
// legal advice.
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/components/marketing/Contact';
import { LegalPage, LegalSection } from '@/components/marketing/LegalPage';

export const metadata = {
    title: 'Terms of Service · Patronus',
};

export default function TermsPage() {
    return (
        <LegalPage title="Terms of Service">
            <LegalSection heading="Who you are dealing with">
                <p>
                    Patronus is an online service operated by Jai Shankar, an individual based in India
                    (&ldquo;we&rdquo;). By creating an account you agree to these terms.
                </p>
            </LegalSection>
            <LegalSection heading="What the service does">
                <p>
                    Patronus helps you keep a record of your work and turn it into resumes and related documents.
                    AI features help you draft and edit; they are checked against your own record, but you are
                    responsible for reviewing anything before you send it to an employer or submit it anywhere.
                </p>
            </LegalSection>
            <LegalSection heading="Your content">
                <p>
                    What you upload or write stays yours. You give us permission to store and process it only to
                    provide the service to you. Do not upload anything you do not have the right to share, and do
                    not use the service to misrepresent your experience.
                </p>
            </LegalSection>
            <LegalSection heading="Plans and payment">
                <p>
                    The free plan is free. Paid plans are monthly subscriptions at the prices on the{' '}
                    <Link href="/pricing" className="underline-offset-4 hover:underline">pricing page</Link>, and
                    renew until cancelled. Cancellation and refunds are covered by the{' '}
                    <Link href="/refund-policy" className="underline-offset-4 hover:underline">refund and cancellation policy</Link>.
                </p>
            </LegalSection>
            <LegalSection heading="Availability">
                <p>
                    We work to keep Patronus available and your data safe, but the service is provided as is,
                    without a guarantee of uninterrupted availability. To the extent the law allows, our liability
                    is limited to the amount you paid us in the three months before the claim.
                </p>
            </LegalSection>
            <LegalSection heading="Ending your account">
                <p>
                    You can stop using Patronus and ask us to delete your account at any time. We may suspend an
                    account that abuses the service or breaks these terms.
                </p>
            </LegalSection>
            <LegalSection heading="Governing law">
                <p>These terms are governed by the laws of India, and disputes are subject to the courts of India.</p>
            </LegalSection>
            <LegalSection heading="Contact">
                <p>
                    Questions about these terms, billing or legal requests:{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:underline">{CONTACT_EMAIL}</a>.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
