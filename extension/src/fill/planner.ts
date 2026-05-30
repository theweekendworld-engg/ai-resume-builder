// Builds a FillPlan from a parsed page model + the user's profile bundle.
// Ported 1:1 from the legacy extension/fill/fill-planner.js with TS types.

import type { NormalizedField, FieldLocator } from '@/parsers';
import {
    getResolvedFieldValue,
    type ResolvedProfileBundle,
    type ResolvedSource,
} from './valueResolver';

export type FillActionKind = 'auto_fill' | 'review_required' | 'manual_upload' | 'skip';

export type FillAction = {
    id: string;
    action: FillActionKind;
    fieldKey?: string;
    fieldLabel: string;
    inputType: string;
    locator: FieldLocator;
    value?: string;
    valuePreview?: string;
    suggestedOption?: string;
    canApply: boolean;
    reason: string;
    confidenceBand: 'high' | 'medium' | 'low';
    confidenceScore: number;
    source: ResolvedSource;
};

export type FillPlan = {
    generatedAt: string;
    safeAutofillCount: number;
    reviewCount: number;
    skipCount: number;
    actions: FillAction[];
};

const DIRECT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url']);
const CHOICE_INPUT_TYPES = new Set(['select', 'radio', 'checkbox']);
const REVIEWABLE_INPUT_TYPES = new Set([
    'text',
    'email',
    'tel',
    'url',
    'select',
    'radio',
    'checkbox',
]);
const SAFE_FIELD_KEYS = new Set([
    'full_name',
    'first_name',
    'last_name',
    'email',
    'phone',
    'linkedin_url',
    'github_url',
    'portfolio_url',
    'current_location',
    'years_of_experience',
]);

function normalizeValue(value: unknown): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toNumber(value: unknown): number | null {
    const match = String(value || '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function matchYearsExperienceOption(option: string, yearsValue: string): boolean {
    const years = toNumber(yearsValue);
    if (years == null) return false;
    const normalized = normalizeValue(option);
    const numbers = normalized.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (numbers.length === 0) return false;
    if (normalized.includes('+') || /(or more|and above|above|over)/.test(normalized)) {
        return years >= (numbers[0] ?? 0);
    }
    if (numbers.length >= 2) {
        return years >= (numbers[0] ?? 0) && years <= (numbers[1] ?? 0);
    }
    return years === numbers[0];
}

function resolveChoiceValue(field: NormalizedField, rawValue: string): string | null {
    const value = String(rawValue || '').trim();
    const options = Array.isArray(field?.options) ? field.options : [];
    if (!value || options.length === 0) return null;

    const normalizedValue = normalizeValue(value);
    const directMatch = options.find((option) => {
        const normalizedOption = normalizeValue(option);
        return (
            normalizedOption === normalizedValue ||
            normalizedOption.includes(normalizedValue) ||
            normalizedValue.includes(normalizedOption)
        );
    });
    if (directMatch) return directMatch;

    if (field.key === 'years_of_experience') {
        return options.find((option) => matchYearsExperienceOption(option, value)) || null;
    }

    return null;
}

function isHighConfidence(field: NormalizedField): boolean {
    return Number(field?.confidenceScore || 0) >= 0.8;
}

function isReviewable(field: NormalizedField): boolean {
    return REVIEWABLE_INPUT_TYPES.has(field.inputType) || field.key === 'resume_upload';
}

function buildReason(
    action: FillActionKind,
    field: NormalizedField,
    valuePresent: boolean,
    choiceMatch: string | null
): string {
    if (action === 'auto_fill') {
        if (choiceMatch) {
            return `Matched ${field.key} to the on-page option "${choiceMatch}" with high-confidence parser output.`;
        }
        return `Matched ${field.key} with high-confidence parser output and a saved profile value.`;
    }
    if (action === 'manual_upload') {
        return 'Resume/CV uploads stay protected. The extension can focus the field and open the picker, but it will not attach a file automatically.';
    }
    if (!field.key) {
        return 'Field meaning is still ambiguous, so it was not selected for autofill.';
    }
    if (!SAFE_FIELD_KEYS.has(field.key)) {
        return `Skipped ${field.key} because the safe autofill set only covers well-understood profile fields.`;
    }
    if (!valuePresent) {
        return `No saved profile value was found for ${field.key}.`;
    }
    if (CHOICE_INPUT_TYPES.has(field.inputType) && !choiceMatch) {
        return `A saved value exists for ${field.key}, but no reliable option match was found in the on-page choices.`;
    }
    if (field.confidenceScore < 0.8) {
        return 'Parser confidence is not high enough yet for automatic fill, but this field can be confirmed individually.';
    }
    return 'Kept for manual review.';
}

function buildAction(
    field: NormalizedField,
    index: number,
    bundle: ResolvedProfileBundle
): FillAction {
    const resolved = getResolvedFieldValue(field.key, bundle);
    const rawValue = String(resolved?.value || '').trim();
    const supportedField = Boolean(field.key) && SAFE_FIELD_KEYS.has(field.key!);
    const directInput = DIRECT_INPUT_TYPES.has(field.inputType);
    const choiceInput = CHOICE_INPUT_TYPES.has(field.inputType);
    const choiceMatch = choiceInput ? resolveChoiceValue(field, rawValue) : null;
    const usableValue = choiceMatch || rawValue;
    const valuePresent = Boolean(usableValue);
    const reviewable = isReviewable(field);
    const highConfidence = isHighConfidence(field);

    let action: FillActionKind = 'skip';
    let canApply = false;

    if (field.key === 'resume_upload' && field.inputType === 'file') {
        action = 'manual_upload';
        canApply = true;
    } else if (supportedField && directInput && valuePresent) {
        action = highConfidence ? 'auto_fill' : 'review_required';
        canApply = true;
    } else if (supportedField && choiceInput && valuePresent) {
        action = highConfidence && Boolean(choiceMatch) ? 'auto_fill' : 'review_required';
        canApply = Boolean(choiceMatch);
    } else if (supportedField && reviewable) {
        action = 'review_required';
        canApply = Boolean(valuePresent);
    }

    return {
        id: `fill-${index + 1}`,
        action,
        fieldKey: field.key,
        fieldLabel: field.label,
        inputType: field.inputType,
        locator: field.locator,
        value: canApply ? usableValue : undefined,
        valuePreview: valuePresent ? usableValue.slice(0, 80) : undefined,
        suggestedOption: choiceMatch || undefined,
        canApply,
        reason: buildReason(action, field, valuePresent, choiceMatch),
        confidenceBand: field.confidenceBand,
        confidenceScore: field.confidenceScore,
        source: resolved?.source ?? { type: 'none', label: 'No profile value' },
    };
}

export function buildFillPlan(
    fields: NormalizedField[],
    bundle: ResolvedProfileBundle
): FillPlan {
    const actions = (fields ?? []).map((field, index) => buildAction(field, index, bundle));
    return {
        generatedAt: new Date().toISOString(),
        safeAutofillCount: actions.filter((item) => item.action === 'auto_fill').length,
        reviewCount: actions.filter(
            (item) => item.action === 'review_required' || item.action === 'manual_upload'
        ).length,
        skipCount: actions.filter((item) => item.action === 'skip').length,
        actions,
    };
}
