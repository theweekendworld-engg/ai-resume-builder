import { Pricing } from '@/components/marketing/Pricing';

export const metadata = {
    title: 'Pricing · Patronus',
    description: 'Free while Patronus launches, with every feature included.',
};

export default function PricingPage() {
    return (
        <div className="pt-6">
            <Pricing id="plans" />
        </div>
    );
}
