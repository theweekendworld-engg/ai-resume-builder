(function registerFillExecutor(globalScope) {
  function dispatchFillEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function normalizeValue(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCssPathForElement(element) {
    if (!(element instanceof Element)) return '';

    const parts = [];
    let current = element;
    let depth = 0;

    while (current && depth < 6 && current !== document.body && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id.slice(0, 40)}`;
        parts.unshift(part);
        break;
      }

      const className = typeof current.className === 'string'
        ? current.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      if (className) {
        part += `.${className.slice(0, 60)}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(' > ');
  }

  function locateByCssPath(cssPath) {
    if (!cssPath) return null;
    try {
      return document.querySelector(cssPath);
    } catch {
      return null;
    }
  }

  function locateField(locator) {
    if (!locator) return null;

    const byCssPath = locateByCssPath(locator.cssPath);
    if (byCssPath instanceof HTMLElement) return byCssPath;

    if (locator.id) {
      const byId = document.getElementById(locator.id);
      if (byId instanceof HTMLElement) return byId;
    }

    if (locator.name) {
      const matches = Array.from(document.querySelectorAll(`[name="${CSS.escape(locator.name)}"]`));
      const byName = typeof locator.nthIndex === 'number' ? matches[locator.nthIndex] : matches[0];
      if (byName instanceof HTMLElement) return byName;
    }

    return null;
  }

  function findGroupInputs(element) {
    if (!(element instanceof HTMLInputElement) || !element.name) return [element];
    return Array.from(document.querySelectorAll(`input[name="${CSS.escape(element.name)}"]`))
      .filter((node) => node instanceof HTMLInputElement);
  }

  function getInputLabelText(element) {
    if (!(element instanceof HTMLInputElement)) return '';

    const labels = [];
    if (element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicit) labels.push(explicit.textContent || '');
    }

    if (element.labels) {
      for (const label of Array.from(element.labels)) {
        labels.push(label.textContent || '');
      }
    }

    const wrappingLabel = element.closest('label');
    if (wrappingLabel) {
      labels.push(wrappingLabel.textContent || '');
    }

    const siblingText = element.parentElement?.textContent || '';
    labels.push(siblingText);

    return labels.find((value) => String(value || '').trim())?.trim() || '';
  }

  function snapshotFieldState(element) {
    if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
      const items = findGroupInputs(element).map((input) => ({
        cssPath: getCssPathForElement(input),
        id: input.id || undefined,
        name: input.name || undefined,
        value: input.value,
        checked: input.checked,
      }));

      return {
        kind: element.type,
        items,
      };
    }

    if (element instanceof HTMLInputElement) {
      return {
        kind: 'input',
        value: element.value,
        checked: element.checked,
      };
    }

    if (element instanceof HTMLTextAreaElement) {
      return {
        kind: 'textarea',
        value: element.value,
      };
    }

    if (element instanceof HTMLSelectElement) {
      return {
        kind: 'select',
        value: element.value,
        selectedIndex: element.selectedIndex,
      };
    }

    return {
      kind: 'content',
      textContent: element.textContent || '',
    };
  }

  function restoreGroupState(state) {
    for (const item of Array.isArray(state?.items) ? state.items : []) {
      const element = locateField({
        cssPath: item.cssPath || '',
        id: item.id,
        name: item.name,
      });
      if (element instanceof HTMLInputElement) {
        element.checked = Boolean(item.checked);
        dispatchFillEvents(element);
      }
    }
  }

  function restoreFieldState(element, state) {
    if (state?.kind === 'radio' || state?.kind === 'checkbox') {
      restoreGroupState(state);
      return;
    }

    if (element instanceof HTMLInputElement) {
      if (typeof state?.value === 'string') element.value = state.value;
      if (typeof state?.checked === 'boolean') element.checked = state.checked;
      dispatchFillEvents(element);
      return;
    }

    if (element instanceof HTMLTextAreaElement) {
      element.value = typeof state?.value === 'string' ? state.value : '';
      dispatchFillEvents(element);
      return;
    }

    if (element instanceof HTMLSelectElement) {
      if (typeof state?.selectedIndex === 'number') {
        element.selectedIndex = state.selectedIndex;
      } else if (typeof state?.value === 'string') {
        element.value = state.value;
      }
      dispatchFillEvents(element);
      return;
    }

    if (typeof state?.textContent === 'string') {
      element.textContent = state.textContent;
      dispatchFillEvents(element);
    }
  }

  function findMatchingSelectOption(element, value) {
    const normalizedValue = normalizeValue(value);
    return Array.from(element.options).find((option) => {
      const normalizedOptionValue = normalizeValue(option.value);
      const normalizedOptionText = normalizeValue(option.textContent || '');
      return normalizedOptionValue === normalizedValue || normalizedOptionText === normalizedValue;
    }) || null;
  }

  function findMatchingGroupedInput(element, value) {
    const normalizedValue = normalizeValue(value);
    const group = findGroupInputs(element);

    return group.find((candidate) => {
      const normalizedCandidateValue = normalizeValue(candidate.value);
      const normalizedLabel = normalizeValue(getInputLabelText(candidate));
      return normalizedCandidateValue === normalizedValue
        || normalizedLabel === normalizedValue
        || normalizedLabel.includes(normalizedValue)
        || normalizedValue.includes(normalizedLabel);
    }) || null;
  }

  function fillField(element, action) {
    if (action.inputType === 'file' && element instanceof HTMLInputElement && element.type === 'file') {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.focus();
      element.click();
      return { status: 'focused', reason: 'Opened the protected file picker for manual upload.' };
    }

    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
      && action.inputType !== 'radio'
      && action.inputType !== 'checkbox'
      && action.inputType !== 'file') {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.focus();
      element.value = action.value || '';
      dispatchFillEvents(element);
      return { status: 'filled' };
    }

    if (element instanceof HTMLSelectElement) {
      const match = findMatchingSelectOption(element, action.value);
      if (!match) {
        return { status: 'failed', reason: 'No reliable option match was found for this select field.' };
      }

      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.focus();
      element.value = match.value;
      dispatchFillEvents(element);
      return { status: 'filled' };
    }

    if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
      const match = findMatchingGroupedInput(element, action.value);
      if (!match) {
        return { status: 'failed', reason: `No reliable option match was found for this ${element.type} field.` };
      }

      match.scrollIntoView({ block: 'center', behavior: 'smooth' });
      match.focus();
      if (element.type === 'checkbox') {
        match.checked = true;
      } else {
        match.checked = true;
      }
      dispatchFillEvents(match);
      return { status: 'filled' };
    }

    return { status: 'failed', reason: `Field type ${action.inputType} is not supported by the safe autofill executor.` };
  }

  async function applyFillPlan(actions) {
    const results = [];
    const undoEntries = [];

    for (const action of Array.isArray(actions) ? actions : []) {
      if ((action?.action !== 'auto_fill' && action?.action !== 'review_required' && action?.action !== 'manual_upload')
        || (!action?.value && action?.action !== 'manual_upload')) {
        results.push({
          actionId: action?.id || '',
          fieldLabel: action?.fieldLabel || 'Unknown field',
          status: 'skipped',
          reason: 'Action was not ready to run.',
        });
        continue;
      }

      const element = locateField(action.locator);
      if (!(element instanceof HTMLElement)) {
        results.push({
          actionId: action.id,
          fieldLabel: action.fieldLabel,
          status: 'failed',
          reason: 'Unable to find the field on the current page.',
        });
        continue;
      }

      const previousState = snapshotFieldState(element);
      const fillResult = fillField(element, action);

      if (fillResult.status === 'failed') {
        results.push({
          actionId: action.id,
          fieldLabel: action.fieldLabel,
          status: 'failed',
          reason: fillResult.reason,
        });
        continue;
      }

      undoEntries.push({
        actionId: action.id,
        fieldLabel: action.fieldLabel,
        locator: action.locator,
        previousState,
      });
      results.push({
        actionId: action.id,
        fieldLabel: action.fieldLabel,
        status: fillResult.status,
        reason: fillResult.reason,
      });
    }

    return {
      appliedCount: results.filter((item) => item.status === 'filled').length,
      restoredCount: 0,
      results,
      undoEntries,
    };
  }

  async function focusField(locator) {
    const element = locateField(locator);
    if (!(element instanceof HTMLElement)) {
      return {
        appliedCount: 0,
        restoredCount: 0,
        results: [{
          actionId: '',
          fieldLabel: 'Field focus',
          status: 'failed',
          reason: 'Unable to find the requested field.',
        }],
      };
    }

    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.focus();
    if (element instanceof HTMLInputElement && element.type === 'file') {
      element.click();
    }

    return {
      appliedCount: 0,
      restoredCount: 0,
      results: [{
        actionId: '',
        fieldLabel: 'Field focus',
        status: 'focused',
        reason: 'Focused the requested field.',
      }],
    };
  }

  async function undoFillPlan(undoEntries) {
    const results = [];

    for (const entry of Array.isArray(undoEntries) ? undoEntries : []) {
      const locator = entry?.locator || {
        cssPath: entry?.previousState?.items?.[0]?.cssPath || '',
        id: entry?.previousState?.items?.[0]?.id,
        name: entry?.previousState?.items?.[0]?.name,
      };
      const element = locateField(locator);
      if (!(element instanceof HTMLElement) && entry?.previousState?.kind !== 'radio' && entry?.previousState?.kind !== 'checkbox') {
        results.push({
          actionId: entry?.actionId || '',
          fieldLabel: entry?.fieldLabel || 'Unknown field',
          status: 'failed',
          reason: 'Unable to find the field for undo.',
        });
        continue;
      }

      restoreFieldState(element, entry.previousState);
      results.push({
        actionId: entry.actionId,
        fieldLabel: entry.fieldLabel,
        status: 'restored',
      });
    }

    return {
      appliedCount: 0,
      restoredCount: results.filter((item) => item.status === 'restored').length,
      results,
    };
  }

  const fillScope = globalScope.PatronusFill = globalScope.PatronusFill || {};
  fillScope.applyFillPlan = applyFillPlan;
  fillScope.undoFillPlan = undoFillPlan;
  fillScope.focusField = focusField;
})(globalThis);
