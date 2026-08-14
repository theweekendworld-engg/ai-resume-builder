import { notFound } from 'next/navigation';

import { PatternsGallery } from '@/components/patterns/dev-gallery';

/**
 * `/dev/patterns` — the pattern library preview.
 *
 * Dev-only. Every component in every variant and state, in both themes, at all
 * three densities, from local fixtures. No data layer, no API calls, no
 * database — it renders with the DB down, which is the point.
 */
export const metadata = {
  title: 'Pattern library · Patronus',
  robots: { index: false, follow: false },
};

export default function PatternsPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <PatternsGallery />;
}
