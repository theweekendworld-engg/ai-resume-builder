(function registerFieldDetector(globalScope) {
  const parser = globalScope.PatronusParser = globalScope.PatronusParser || {};
  const utils = parser.utils;

  function inferInputType(element) {
    if (!(element instanceof HTMLElement)) return 'unknown';
    if (element instanceof HTMLTextAreaElement) return 'textarea';
    if (element instanceof HTMLSelectElement) return 'select';
    if (element instanceof HTMLInputElement) {
      const type = (element.type || 'text').toLowerCase();
      if (['text', 'email', 'tel', 'url', 'radio', 'checkbox', 'file'].includes(type)) return type;
      return type === 'hidden' ? 'unknown' : 'text';
    }
    return element.getAttribute('contenteditable') === 'true' ? 'textarea' : 'unknown';
  }

  function getExplicitLabels(element) {
    const labels = [];

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (explicit && utils.isElementVisible(explicit)) {
          labels.push({ text: utils.readText(explicit), weight: 1, reason: 'explicit_label' });
        }
      }

      if (element.labels) {
        for (const label of Array.from(element.labels)) {
          if (utils.isElementVisible(label)) {
            labels.push({ text: utils.readText(label), weight: 0.96, reason: 'associated_label' });
          }
        }
      }
    }

    const wrappingLabel = element.closest('label');
    if (wrappingLabel && utils.isElementVisible(wrappingLabel)) {
      labels.push({ text: utils.readText(wrappingLabel), weight: 0.92, reason: 'wrapping_label' });
    }

    return labels;
  }

  function getAriaLabels(element) {
    const labels = [];
    const ariaLabel = utils.normalizeWhitespace(element.getAttribute('aria-label') || '');
    if (ariaLabel) {
      labels.push({ text: ariaLabel, weight: 0.88, reason: 'aria_label' });
    }

    const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    for (const id of labelledBy) {
      const target = document.getElementById(id);
      if (target && utils.isElementVisible(target)) {
        labels.push({ text: utils.readText(target), weight: 0.84, reason: 'aria_labelledby' });
      }
    }

    return labels;
  }

  function getNearbyTextLabels(element) {
    const labels = [];
    const placeholder = utils.normalizeWhitespace(element.getAttribute('placeholder') || '');
    if (placeholder) {
      labels.push({ text: placeholder, weight: 0.45, reason: 'placeholder' });
    }

    const parent = element.parentElement;
    if (parent) {
      const localTexts = Array.from(parent.children)
        .filter((node) => node !== element && node instanceof HTMLElement && utils.isElementVisible(node))
        .map((node) => utils.readText(node))
        .filter((text) => text && text.length <= 180)
        .slice(0, 4);

      for (const text of localTexts) {
        labels.push({ text, weight: 0.68, reason: 'local_group_text' });
      }
    }

    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && utils.isElementVisible(sibling)) {
        const text = utils.readText(sibling);
        if (text && text.length <= 180) {
          labels.push({ text, weight: 0.62, reason: 'previous_sibling' });
          break;
        }
      }
      sibling = sibling.previousElementSibling;
    }

    const fieldset = element.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend && utils.isElementVisible(legend)) {
      labels.push({ text: utils.readText(legend), weight: 0.8, reason: 'legend' });
    }

    return labels;
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();
    const output = [];

    for (const candidate of candidates) {
      const text = utils.normalizeWhitespace(candidate.text);
      const normalized = utils.normalizeToken(text);
      if (!text || !normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push({ ...candidate, text });
    }

    return output;
  }

  function getHelperTexts(element) {
    const values = [];
    const describedBy = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    for (const id of describedBy) {
      const target = document.getElementById(id);
      if (target && utils.isElementVisible(target)) {
        values.push(utils.readText(target));
      }
    }

    const parent = element.parentElement;
    if (parent) {
      for (const node of Array.from(parent.querySelectorAll('small, p, span, div'))) {
        if (!(node instanceof HTMLElement) || !utils.isElementVisible(node) || node.contains(element)) continue;
        const text = utils.readText(node);
        if (!text || text.length > 220) continue;
        if (/required|optional|example|format|answer/i.test(text)) {
          values.push(text);
        }
      }
    }

    return utils.uniqueStrings(values).slice(0, 4);
  }

  function getOptions(element) {
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.options)
        .map((option) => utils.normalizeWhitespace(option.textContent || option.value))
        .filter(Boolean)
        .slice(0, 20);
    }

    if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
      const groupName = element.name;
      const group = groupName
        ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(groupName)}"]`))
        : [element];

      return group
        .filter((item) => item instanceof HTMLInputElement && utils.isElementVisible(item))
        .map((item) => {
          const labels = dedupeCandidates([
            ...getExplicitLabels(item),
            ...getAriaLabels(item),
            ...getNearbyTextLabels(item),
          ]);
          return labels[0]?.text || utils.normalizeWhitespace(item.value);
        })
        .filter(Boolean)
        .slice(0, 20);
    }

    return [];
  }

  function inferFieldKey(field) {
    const sources = [
      field.label,
      field.name,
      field.id,
      field.placeholder,
      field.sectionHeading,
      field.helperTextCandidates.join(' '),
    ].filter(Boolean).join(' ');
    const text = utils.normalizeToken(sources);
    const questionLike = /[?]/.test(field.label)
      || /(why|describe|tell us|please share|what makes|how do you)/.test(text);

    if ((field.inputType === 'textarea' || field.inputType === 'text') && questionLike) {
      return {
        key: 'custom_question',
        confidenceScore: field.inputType === 'textarea' ? 0.9 : 0.76,
        reasons: ['Field label reads like a custom application question.'],
      };
    }

    const rules = [
      { key: 'full_name', weight: 0.96, match: /full name|your name|legal name/ },
      { key: 'first_name', weight: 0.96, match: /first name|given name/ },
      { key: 'last_name', weight: 0.96, match: /last name|family name|surname/ },
      { key: 'email', weight: field.inputType === 'email' ? 0.99 : 0.9, match: /email|e mail/ },
      { key: 'phone', weight: field.inputType === 'tel' ? 0.98 : 0.86, match: /phone|mobile|telephone|contact number/ },
      { key: 'current_location', weight: 0.84, match: /location|city|state|where are you based|current address/ },
      { key: 'linkedin_url', weight: 0.97, match: /linkedin/ },
      { key: 'github_url', weight: 0.97, match: /github/ },
      { key: 'portfolio_url', weight: 0.86, match: /portfolio|personal website|website|homepage/ },
      { key: 'resume_upload', weight: field.inputType === 'file' ? 0.99 : 0.88, match: /resume|cv|attach resume|upload resume/ },
      { key: 'cover_letter', weight: field.inputType === 'textarea' ? 0.92 : 0.72, match: /cover letter/ },
      { key: 'work_authorization', weight: 0.9, match: /work authorization|authorized to work|work permit|legally authorized/ },
      { key: 'visa_sponsorship_required', weight: 0.9, match: /visa|sponsorship|sponsor now or in the future/ },
      { key: 'salary_expectation', weight: 0.88, match: /salary|compensation|pay expectation|desired pay|salary expectation/ },
      { key: 'notice_period', weight: 0.84, match: /notice period|available to start|start date availability/ },
      { key: 'years_of_experience', weight: 0.82, match: /years of experience|experience in years|how many years/ },
      { key: 'school_name', weight: 0.86, match: /school|university|college|institution/ },
      { key: 'degree', weight: 0.84, match: /degree|major|field of study/ },
      { key: 'company_name', weight: 0.8, match: /company|employer|current company|organization/ },
      { key: 'job_title', weight: 0.8, match: /job title|title|position/ },
      { key: 'start_date', weight: 0.78, match: /start date|from date|begin date/ },
      { key: 'end_date', weight: 0.78, match: /end date|to date|finish date/ },
    ];

    for (const rule of rules) {
      if (rule.match.test(text)) {
        return {
          key: rule.key,
          confidenceScore: rule.weight,
          reasons: [`Matched semantic rule for ${rule.key}.`],
        };
      }
    }

    if (questionLike) {
      return {
        key: 'custom_question',
        confidenceScore: field.inputType === 'textarea' ? 0.85 : 0.7,
        reasons: ['Field label reads like a custom application question.'],
      };
    }

    return {
      key: undefined,
      confidenceScore: 0.35,
      reasons: ['No strong semantic rule matched the field.'],
    };
  }

  function inferQuestionType(labelText) {
    const text = utils.normalizeToken(labelText);
    if (/cover letter|motivation letter|application statement/.test(text)) return 'cover_letter';
    if (/why.*(company|here|us|join)/.test(text)) return 'why_company';
    if (/why.*(role|position|job)/.test(text)) return 'why_role';
    if (/introduce yourself|tell us about yourself|self intro/.test(text)) return 'self_intro';
    if (/project|build|ship/.test(text)) return 'project_story';
    if (/experience with|worked with|familiar with/.test(text)) return 'experience_with_skill';
    if (/authorized|eligible|citizen|sponsorship|visa/.test(text)) return 'eligibility';
    if (/salary|compensation|pay/.test(text)) return 'compensation';
    return 'other';
  }

  function detectQuestions(fields) {
    return fields
      .filter((field) => field.key === 'custom_question' || field.key === 'cover_letter')
      .map((field, index) => ({
        id: `question-${index + 1}`,
        questionText: field.label,
        typeHint: inferQuestionType(field.label),
        answerMode: field.inputType === 'textarea'
          ? 'long_text'
          : field.inputType === 'select'
            ? 'single_select'
              : field.inputType === 'checkbox'
              ? 'multi_select'
              : 'short_text',
        confidenceScore: field.confidenceScore,
        confidenceBand: field.confidenceBand,
        helperText: field.helperTextCandidates || [],
        sectionHeading: field.sectionHeading,
        locator: field.locator,
      }));
  }

  function collectNormalizedFields() {
    const elements = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
      .filter((element) => element instanceof HTMLElement && utils.isElementVisible(element))
      .filter((element) => !(element instanceof HTMLInputElement && element.type === 'hidden'));

    const fields = [];

    for (const element of elements) {
      const inputType = inferInputType(element);
      const labelCandidates = dedupeCandidates([
        ...getExplicitLabels(element),
        ...getAriaLabels(element),
        ...getNearbyTextLabels(element),
      ]).sort((left, right) => right.weight - left.weight);

      const primaryLabel = labelCandidates[0]?.text || utils.normalizeWhitespace(element.getAttribute('name') || '') || 'Untitled field';
      const helperTextCandidates = getHelperTexts(element);
      const sectionHeading = utils.getNearestHeadingText(element) || undefined;
      const required = element.matches('[required], [aria-required="true"]')
        || /\brequired\b/i.test(primaryLabel)
        || helperTextCandidates.some((text) => /\brequired\b/i.test(text));
      const options = getOptions(element);
      const semantic = inferFieldKey({
        label: primaryLabel,
        name: element.getAttribute('name') || '',
        id: element.getAttribute('id') || '',
        placeholder: element.getAttribute('placeholder') || '',
        sectionHeading: sectionHeading || '',
        helperTextCandidates,
        inputType,
      });
      const locator = {
        cssPath: utils.getElementPath(element),
        name: element.getAttribute('name') || undefined,
        id: element.getAttribute('id') || undefined,
        nthIndex: element.parentElement
          ? Array.from(element.parentElement.children)
            .filter((child) => child.tagName === element.tagName)
            .indexOf(element)
          : undefined,
      };

      const labelConfidence = labelCandidates[0]?.weight || 0.3;
      const confidenceScore = utils.clamp((semantic.confidenceScore * 0.68) + (labelConfidence * 0.32), 0, 1);

      fields.push({
        key: semantic.key,
        label: primaryLabel,
        inputType,
        required,
        confidenceBand: utils.confidenceBand(confidenceScore),
        confidenceScore,
        reasons: utils.uniqueStrings([
          ...semantic.reasons,
          labelCandidates[0] ? `Primary label recovered from ${labelCandidates[0].reason}.` : '',
          sectionHeading ? `Field appears under "${sectionHeading}".` : '',
        ]).slice(0, 4),
        sectionHeading,
        options,
        locator,
        name: element.getAttribute('name') || '',
        id: element.getAttribute('id') || '',
        placeholder: element.getAttribute('placeholder') || '',
        helperTextCandidates,
      });
    }

    const dedupedFields = fields.filter((field, index) => {
      return fields.findIndex((candidate) => candidate.locator.cssPath === field.locator.cssPath) === index;
    });

    return {
      fields: dedupedFields.map((field) => ({
        key: field.key,
        label: field.label,
        inputType: field.inputType,
        required: field.required,
        confidenceBand: field.confidenceBand,
        confidenceScore: field.confidenceScore,
        reasons: field.reasons,
        sectionHeading: field.sectionHeading,
        options: field.options,
        locator: field.locator,
      })),
      questions: detectQuestions(dedupedFields),
    };
  }

  parser.collectNormalizedFields = collectNormalizedFields;
})(globalThis);
