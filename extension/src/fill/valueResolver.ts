// Resolves a semantic field key (e.g. 'email', 'first_name') to the user's
// profile value plus a provenance source. Ported 1:1 from the legacy
// extension/fill/value-resolver.js with TS types added.

export type ResolvedSource = {
    type: 'profile' | 'derived' | 'none';
    path?: string;
    label: string;
};

export type ResolvedValue = {
    value: string;
    source: ResolvedSource;
};

export type ResolvedProfileBundle = {
    profile?: {
        fullName?: string;
        email?: string;
        phone?: string;
        location?: string;
        linkedin?: string;
        github?: string;
        website?: string;
        yearsExperience?: string;
    };
};

function normalizeUrl(value: unknown): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
    const trimmed = String(fullName || '').trim();
    if (!trimmed) return { firstName: '', lastName: '' };
    const parts = trimmed.split(/\s+/);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
    };
}

export function buildResolvedProfile(
    bundle: ResolvedProfileBundle
): Record<string, ResolvedValue> {
    const fullName = bundle?.profile?.fullName || '';
    const nameParts = splitFullName(fullName);

    return {
        full_name: {
            value: fullName,
            source: { type: 'profile', path: 'profile.fullName', label: 'Full name' },
        },
        first_name: {
            value: nameParts.firstName,
            source: { type: 'derived', path: 'profile.fullName', label: 'First name from full name' },
        },
        last_name: {
            value: nameParts.lastName,
            source: { type: 'derived', path: 'profile.fullName', label: 'Last name from full name' },
        },
        email: {
            value: bundle?.profile?.email || '',
            source: { type: 'profile', path: 'profile.email', label: 'Email' },
        },
        phone: {
            value: bundle?.profile?.phone || '',
            source: { type: 'profile', path: 'profile.phone', label: 'Phone' },
        },
        linkedin_url: {
            value: normalizeUrl(bundle?.profile?.linkedin || ''),
            source: { type: 'profile', path: 'profile.linkedin', label: 'LinkedIn' },
        },
        github_url: {
            value: normalizeUrl(bundle?.profile?.github || ''),
            source: { type: 'profile', path: 'profile.github', label: 'GitHub' },
        },
        portfolio_url: {
            value: normalizeUrl(bundle?.profile?.website || ''),
            source: { type: 'profile', path: 'profile.website', label: 'Website' },
        },
        current_location: {
            value: bundle?.profile?.location || '',
            source: { type: 'profile', path: 'profile.location', label: 'Location' },
        },
        years_of_experience: {
            value: bundle?.profile?.yearsExperience || '',
            source: {
                type: 'profile',
                path: 'profile.yearsExperience',
                label: 'Years of experience',
            },
        },
    };
}

export function getResolvedFieldValue(
    fieldKey: string | undefined,
    bundle: ResolvedProfileBundle
): ResolvedValue {
    if (!fieldKey) {
        return { value: '', source: { type: 'none', label: 'No semantic field key' } };
    }
    const profile = buildResolvedProfile(bundle);
    return (
        profile[fieldKey] || {
            value: '',
            source: { type: 'none', label: 'Field key not supported for safe autofill' },
        }
    );
}
