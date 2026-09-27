import { Pricing } from '@/components/marketing/Pricing';

export const metadata = {
    title: 'Pricing · Patronus',
    description: 'The free plan, and the paid plans with their prices.',
};

export default function PricingPage() {
    return (
        <div className="pt-6">
            <Pricing id="plans" />
        </div>
    );
}
