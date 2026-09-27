// TODO(owner): review this policy before submitting the site for payment-gateway
// (Razorpay) review. Keep the list of processors in step with the services
// actually configured in production.
import { CONTACT_EMAIL } from '@/components/marketing/Contact';
import { LegalPage, LegalSection } from '@/components/marketing/LegalPage';

export const metadata = {
    title: 'Privacy Policy · Patronus',
};

export default function PrivacyPage() {
    return (
        <LegalPage title="Privacy Policy">
            <LegalSection heading="What we collect">
                <p>
                    Your account details (name and email, through our sign-in provider), the resume content and
                    work history you upload or write, the wins you log, job postings you share with us, and basic
                    usage records needed to run and secure the service.
                </p>
            </LegalSection>
            <LegalSection heading="How it is used">
                <p>
                    Only to provide Patronus to you: storing your record, generating and editing your documents,
                    and analysing job postings you share. Your data is never sold, and never used to train AI
                    models.
                </p>
                <p>
                    Wins you mark confidential are excluded from anything that leaves the product, such as resumes
                    and application answers.
                </p>
            </LegalSection>
            <LegalSection heading="Who processes it for us">
                <p>
                    Service providers that host and run Patronus: sign-in and account management, application
                    hosting, the database and file storage, and AI model providers that process text to produce
                    your documents. If you connect a messaging app such as Telegram, messages you send the bot are
                    processed to answer you. Each provider handles data only to deliver its part of the service.
                </p>
            </LegalSection>
            <LegalSection heading="Your choices">
                <p>
                    You can edit or delete your content in the app, export it, and ask us to delete your account
                    and data by emailing{' '}
                    <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:underline">{CONTACT_EMAIL}</a>.
                    We act on deletion requests within 30 days.
                </p>
            </LegalSection>
            <LegalSection heading="Cookies">
                <p>We use the cookies needed to keep you signed in and to protect the service. We do not use advertising cookies.</p>
            </LegalSection>
            <LegalSection heading="Operator">
                <p>Patronus is operated by Jai Shankar, an individual based in India. The laws of India apply to this policy.</p>
            </LegalSection>
        </LegalPage>
    );
}
