function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function normalizeHelperText(helperText?: unknown): string[] {
  if (!Array.isArray(helperText)) return [];
  return helperText
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildQuestionFingerprint(params: {
  questionText: string;
  helperText?: unknown;
  type: string;
}) {
  const questionText = String(params.questionText || '').trim();
  const helperText = normalizeHelperText(params.helperText);
  const normalizedQuestion = normalizeText(questionText);
  const helperContext = normalizeText(helperText.join(' '));
  const classificationText = `${normalizedQuestion} ${helperContext}`.trim();

  if (params.type === 'eligibility') {
    if (/sponsor|visa/.test(classificationText)) return 'eligibility:sponsorship';
    if (/authoriz|eligible|citizen|work authorization/.test(classificationText)) return 'eligibility:work_authorization';
    return 'eligibility:general';
  }

  if (params.type === 'compensation') {
    if (/salary|compensation|pay range|desired pay|expected pay/.test(classificationText)) return 'compensation:desired_compensation';
    if (/notice|start date|availability|available to start/.test(classificationText)) return 'compensation:notice_period';
    if (/relocat/.test(classificationText)) return 'compensation:relocation';
    if (/remote|hybrid|onsite|on site|work mode/.test(classificationText)) return 'compensation:work_mode';
    return 'compensation:general';
  }

  if (params.type === 'self_intro') {
    return 'self_intro:background';
  }

  const tokenSignature = tokenize(questionText).slice(0, 10).join('-') || 'general';
  return `${params.type}:${tokenSignature}`;
}
