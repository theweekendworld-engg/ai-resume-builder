import { buildFillPlan } from './fill/fill-planner.js';

const heading = document.getElementById('heading');
const subheading = document.getElementById('subheading');
const platform = document.getElementById('platform');
const pageKind = document.getElementById('page-kind');
const fieldCount = document.getElementById('field-count');
const jdConfidence = document.getElementById('jd-confidence');
const regionCount = document.getElementById('region-count');
const questionCount = document.getElementById('question-count');
const metadata = document.getElementById('metadata');
const labels = document.getElementById('labels');
const planList = document.getElementById('plan-list');
const fillStatus = document.getElementById('fill-status');
const safeFillCount = document.getElementById('safe-fill-count');
const reviewCount = document.getElementById('review-count');
const planFillButton = document.getElementById('plan-fill');
const applyFillButton = document.getElementById('apply-fill');
const undoFillButton = document.getElementById('undo-fill');
const questionStatus = document.getElementById('question-status');
const questionList = document.getElementById('question-list');
const questionEmpty = document.getElementById('question-empty');
const questionWorkspace = document.getElementById('question-workspace');
const questionWorkspaceTitle = document.getElementById('question-workspace-title');
const questionWorkspaceMeta = document.getElementById('question-workspace-meta');
const toneButtons = document.getElementById('tone-buttons');
const answerEditor = document.getElementById('answer-editor');
const copyAnswerButton = document.getElementById('copy-answer');
const insertAnswerButton = document.getElementById('insert-answer');
const saveAnswerButton = document.getElementById('save-answer');
const questionWarnings = document.getElementById('question-warnings');
const supportingFacts = document.getElementById('supporting-facts');

const state = {
  context: null,
  bundle: null,
  plan: null,
  hasUndo: false,
  actionResults: {},
  questions: {
    selectedId: null,
    items: {},
  },
};

function formatConfidence(context) {
  const band = context?.jobDescription?.confidenceBand || context?.classification?.confidenceBand || 'unknown';
  const score = typeof context?.jobDescription?.confidenceScore === 'number'
    ? `${Math.round(context.jobDescription.confidenceScore * 100)}%`
    : 'n/a';
  return `${band} (${score})`;
}

function setStatus(message) {
  fillStatus.textContent = message;
}

function setQuestionStatus(message) {
  questionStatus.textContent = message;
}

function renderList(items) {
  labels.replaceChildren();

  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    labels.appendChild(li);
  }
}

function getPreviewItems(plan) {
  if (!plan?.actions) return [];

  const priority = {
    auto_fill: 0,
    review_required: 1,
    manual_upload: 2,
    skip: 3,
  };

  return [...plan.actions]
    .filter((action) => action.action !== 'skip')
    .sort((left, right) => {
      const actionDelta = priority[left.action] - priority[right.action];
      if (actionDelta !== 0) return actionDelta;
      return right.confidenceScore - left.confidenceScore;
    })
    .slice(0, 12);
}

function getActionButtonLabel(action) {
  if (action.action === 'manual_upload') return 'Open Picker';
  return 'Fill This';
}

function renderPlan(plan) {
  planList.replaceChildren();
  safeFillCount.textContent = String(plan?.safeAutofillCount ?? 0);
  reviewCount.textContent = String(plan?.reviewCount ?? 0);

  if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.textContent = 'No supported autofill targets were found on this page yet.';
    planList.appendChild(li);
    return;
  }

  const previewItems = getPreviewItems(plan);

  if (previewItems.length === 0) {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.textContent = 'The parser found fields, but none are safe enough for autofill yet.';
    planList.appendChild(li);
    return;
  }

  for (const action of previewItems) {
    const li = document.createElement('li');
    li.className = 'plan-item';

    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = action.action === 'auto_fill'
      ? 'Auto Fill'
      : action.action === 'manual_upload'
        ? 'Protected Upload'
        : 'Review';

    const title = document.createElement('strong');
    title.textContent = action.fieldLabel;

    const preview = document.createElement('p');
    preview.textContent = action.valuePreview
      ? `Suggested value: ${action.valuePreview}`
      : action.reason;

    const meta = document.createElement('p');
    meta.textContent = [
      action.fieldKey || 'unmapped',
      `${Math.round(action.confidenceScore * 100)}% confidence`,
      action.suggestedOption ? `Option: ${action.suggestedOption}` : '',
    ].filter(Boolean).join(' | ');

    li.append(pill, title, preview, meta);

    const actionRow = document.createElement('div');
    actionRow.className = 'plan-actions';

    if (action.canApply) {
      const button = document.createElement('button');
      button.textContent = getActionButtonLabel(action);
      button.dataset.actionId = action.id;
      button.dataset.kind = action.action;
      actionRow.appendChild(button);
    }

    if (action.action === 'review_required' && action.canApply) {
      const note = document.createElement('button');
      note.textContent = 'Keep Manual';
      note.className = 'secondary';
      note.disabled = true;
      actionRow.appendChild(note);
    }

    if (actionRow.childElementCount > 0) {
      li.appendChild(actionRow);
    }

    const latestResult = state.actionResults[action.id];
    if (latestResult) {
      const resultNote = document.createElement('p');
      resultNote.textContent = latestResult;
      li.appendChild(resultNote);
    }

    planList.appendChild(li);
  }
}

function getVisibleQuestions(context) {
  const questions = Array.isArray(context?.questions) ? context.questions : [];
  return questions.filter((question) => question.answerMode === 'short_text' || question.answerMode === 'long_text');
}

function getQuestionKey(question) {
  return question?.id || question?.locator?.cssPath || question?.questionText || '';
}

function getQuestionEntry(questionId) {
  if (!state.questions.items[questionId]) {
    state.questions.items[questionId] = {
      questionId: null,
      selectedTone: 'balanced',
      drafts: [],
      warnings: [],
      classification: null,
      editorText: '',
      loading: false,
      saving: false,
      savedAt: null,
    };
  }

  return state.questions.items[questionId];
}

function updateButtons() {
  const safeActions = state.plan?.actions?.filter((action) => action.action === 'auto_fill') ?? [];
  applyFillButton.disabled = safeActions.length === 0;
  undoFillButton.disabled = !state.hasUndo;

  const selectedQuestion = getSelectedQuestion();
  const selectedEntry = selectedQuestion ? getQuestionEntry(getQuestionKey(selectedQuestion)) : null;
  const hasAnswer = Boolean(answerEditor.value.trim());
  copyAnswerButton.disabled = !hasAnswer;
  insertAnswerButton.disabled = !selectedQuestion?.locator || !hasAnswer || Boolean(selectedEntry?.loading);
  saveAnswerButton.disabled = !selectedEntry?.questionId || !hasAnswer || Boolean(selectedEntry?.saving);
}

function renderContext(context) {
  if (!context) {
    heading.textContent = 'Waiting for page context';
    subheading.textContent = 'Open a job page or application form to begin detection.';
    platform.textContent = 'Unknown';
    pageKind.textContent = 'Unknown';
    fieldCount.textContent = '0';
    jdConfidence.textContent = 'Unknown';
    regionCount.textContent = '0';
    questionCount.textContent = '0';
    metadata.textContent = 'Waiting for parsed job metadata.';
    renderList([]);
    renderPlan(null);
    renderQuestions();
    return;
  }

  const roleTitle = context.metadata?.roleTitle || context.heading || context.visibleTitle || 'Page detected';
  const companyName = context.metadata?.companyName || context.visibleTitle || 'Current tab';
  const questionLabels = getVisibleQuestions(context)
    .map((question) => question.questionText)
    .slice(0, 4);
  const fieldLabels = Array.isArray(context.fields)
    ? context.fields.map((field) => field.label).slice(0, 4)
    : [];

  heading.textContent = roleTitle;
  subheading.textContent = context.url || companyName;
  platform.textContent = context.classification?.platform || 'Unknown';
  pageKind.textContent = context.classification?.pageKind || 'Unknown';
  fieldCount.textContent = String(context.stats?.visibleFieldCount ?? context.fields?.length ?? 0);
  jdConfidence.textContent = formatConfidence(context);
  regionCount.textContent = String(context.stats?.reducedRegionCount ?? context.reducedRegions?.length ?? 0);
  questionCount.textContent = String(getVisibleQuestions(context).length);
  metadata.textContent = [
    companyName,
    context.metadata?.location,
    context.parserError ? `Parser note: ${context.parserError}` : '',
  ].filter(Boolean).join(' | ');

  renderList(questionLabels.length > 0 ? questionLabels : fieldLabels);
  renderQuestions();
}

function getContextSignature(context) {
  return JSON.stringify({
    url: context?.url || '',
    pageKind: context?.classification?.pageKind || '',
    roleTitle: context?.metadata?.roleTitle || '',
    companyName: context?.metadata?.companyName || '',
    fields: Array.isArray(context?.fields)
      ? context.fields.map((field) => ({
        key: field.key || '',
        label: field.label || '',
        inputType: field.inputType || '',
        locator: field.locator?.cssPath || '',
      }))
      : [],
    questions: getVisibleQuestions(context).map((question) => ({
      id: getQuestionKey(question),
      questionText: question.questionText,
      answerMode: question.answerMode,
      locator: question.locator?.cssPath || '',
    })),
  });
}

function pruneQuestionState() {
  const questions = getVisibleQuestions(state.context);
  const visibleIds = new Set(questions.map((question) => getQuestionKey(question)));

  for (const key of Object.keys(state.questions.items)) {
    if (!visibleIds.has(key)) {
      delete state.questions.items[key];
    }
  }

  if (state.questions.selectedId && !visibleIds.has(state.questions.selectedId)) {
    state.questions.selectedId = null;
  }
}

async function refreshContext() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT' });
  if (!response?.ok) {
    state.context = null;
    state.hasUndo = false;
    state.plan = null;
    state.actionResults = {};
    state.questions.items = {};
    state.questions.selectedId = null;
    renderContext(null);
    updateButtons();
    return;
  }

  const previousSignature = getContextSignature(state.context);
  const nextSignature = getContextSignature(response.context);

  state.context = response.context;
  state.hasUndo = Boolean(response.hasUndo);

  if (previousSignature !== nextSignature) {
    state.plan = null;
    state.actionResults = {};
  }

  pruneQuestionState();
  renderContext(state.context);
  renderPlan(state.plan);
  renderQuestionWorkspace();
  updateButtons();
}

async function ensureBundle() {
  if (state.bundle) return state.bundle;

  setStatus('Loading saved profile data...');
  const response = await chrome.runtime.sendMessage({ type: 'GET_EXTENSION_PROFILE_BUNDLE' });
  if (!response?.ok) {
    throw new Error(response?.error || 'Unable to load extension profile bundle');
  }

  state.bundle = response.bundle;
  return state.bundle;
}

async function planAutofill() {
  if (!state.context) {
    setStatus('Open a job application page first so the parser has fields to review.');
    return;
  }

  try {
    const bundle = await ensureBundle();
    state.plan = buildFillPlan(state.context, bundle);
    state.actionResults = {};
    renderPlan(state.plan);
    updateButtons();

    if (state.plan.safeAutofillCount > 0) {
      setStatus(`Prepared ${state.plan.safeAutofillCount} safe autofill actions and ${state.plan.reviewCount} review items.`);
    } else if (state.plan.reviewCount > 0) {
      setStatus('No fields qualified for bulk autofill, but review items can now be confirmed one by one.');
    } else {
      setStatus('No supported low-risk fields were detected on this page.');
    }
  } catch (error) {
    state.plan = null;
    state.actionResults = {};
    renderPlan(null);
    updateButtons();
    setStatus(error instanceof Error ? error.message : 'Unable to build the autofill plan.');
  }
}

async function applyActions(actions, message) {
  const response = await chrome.runtime.sendMessage({
    type: 'APPLY_FILL_PLAN',
    actions,
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to apply the autofill plan.');
  }

  state.hasUndo = Boolean(response.hasUndo);
  updateButtons();

  const results = Array.isArray(response.result?.results) ? response.result.results : [];
  for (const result of results) {
    if (result?.actionId) {
      state.actionResults[result.actionId] = result.reason
        || (result.status === 'filled' ? 'Filled successfully.' : `Status: ${result.status}`);
    }
  }

  const appliedCount = response.result?.appliedCount ?? 0;
  setStatus(message(appliedCount, results));
  renderPlan(state.plan);
  await refreshContext();
}

async function applyFill() {
  const safeActions = state.plan?.actions?.filter((action) => action.action === 'auto_fill') ?? [];
  if (safeActions.length === 0) {
    setStatus('There are no safe autofill actions ready to apply.');
    return;
  }

  setStatus(`Applying ${safeActions.length} safe autofill actions...`);
  try {
    await applyActions(
      safeActions,
      (appliedCount) => `Applied ${appliedCount} safe field${appliedCount === 1 ? '' : 's'}. You can undo the last run for this tab.`
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to apply the autofill plan.');
  }
}

async function runSingleAction(actionId) {
  const action = state.plan?.actions?.find((entry) => entry.id === actionId);
  if (!action) {
    setStatus('That plan item is no longer available. Rebuild the autofill plan and try again.');
    return;
  }

  if (action.action === 'manual_upload') {
    setStatus(`Opening the protected picker for "${action.fieldLabel}"...`);
    const response = await chrome.runtime.sendMessage({
      type: 'FOCUS_FIELD',
      locator: action.locator,
    });

    if (!response?.ok) {
      setStatus(response?.error || 'Failed to focus the upload field.');
      return;
    }

    state.actionResults[action.id] = 'Focused the upload field and opened the picker.';
    renderPlan(state.plan);
    setStatus(`Opened the picker for "${action.fieldLabel}". Choose the file manually to stay in control.`);
    return;
  }

  if (!action.canApply) {
    setStatus(`"${action.fieldLabel}" does not have a reliable suggested value yet.`);
    return;
  }

  setStatus(`Applying "${action.fieldLabel}"...`);
  try {
    await applyActions(
      [action],
      (_appliedCount, results) => {
        const result = results[0];
        if (result?.status === 'filled') {
          return `Filled "${action.fieldLabel}". You can undo the last single-field run for this tab.`;
        }
        return result?.reason || `Finished handling "${action.fieldLabel}".`;
      }
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : `Failed to fill "${action.fieldLabel}".`);
  }
}

async function undoLastFill() {
  setStatus('Restoring the last autofill run...');
  const response = await chrome.runtime.sendMessage({ type: 'UNDO_LAST_FILL' });

  if (!response?.ok) {
    setStatus(response?.error || 'Failed to undo the last autofill run.');
    return;
  }

  state.hasUndo = false;
  updateButtons();
  const restoredCount = response.result?.restoredCount ?? 0;
  setStatus(`Restored ${restoredCount} field${restoredCount === 1 ? '' : 's'} from the last autofill run.`);
  await refreshContext();
}

function getSelectedQuestion() {
  if (!state.questions.selectedId) return null;
  return getVisibleQuestions(state.context).find((question) => getQuestionKey(question) === state.questions.selectedId) ?? null;
}

function renderQuestions() {
  questionList.replaceChildren();

  const questions = getVisibleQuestions(state.context);
  if (questions.length === 0) {
    const li = document.createElement('li');
    li.className = 'question-item';
    li.textContent = 'No custom text questions were confidently detected on this page yet.';
    questionList.appendChild(li);
    renderQuestionWorkspace();
    return;
  }

  for (const question of questions.slice(0, 8)) {
    const id = getQuestionKey(question);
    const entry = getQuestionEntry(id);
    const li = document.createElement('li');
    li.className = 'question-item';

    const title = document.createElement('strong');
    title.textContent = question.questionText;

    const helper = document.createElement('p');
    const helperText = Array.isArray(question.helperText) ? question.helperText[0] : '';
    helper.textContent = helperText || question.sectionHeading || 'Detected long-form question';

    const meta = document.createElement('p');
    meta.className = 'question-meta';
    meta.textContent = [
      question.typeHint || 'other',
      `${Math.round((question.confidenceScore ?? 0) * 100)}% confidence`,
      question.answerMode || '',
      entry.savedAt ? 'saved' : '',
    ].filter(Boolean).join(' | ');

    const actionRow = document.createElement('div');
    actionRow.className = 'question-actions';

    const selectButton = document.createElement('button');
    selectButton.className = state.questions.selectedId === id ? '' : 'secondary';
    selectButton.dataset.questionId = id;
    selectButton.dataset.action = 'select';
    selectButton.textContent = state.questions.selectedId === id ? 'Selected' : 'Open';
    actionRow.appendChild(selectButton);

    const suggestButton = document.createElement('button');
    suggestButton.dataset.questionId = id;
    suggestButton.dataset.action = 'suggest';
    suggestButton.disabled = entry.loading;
    suggestButton.textContent = entry.loading ? 'Generating...' : (entry.drafts.length > 0 ? 'Regenerate' : 'Suggest');
    actionRow.appendChild(suggestButton);

    li.append(title, helper, meta, actionRow);
    questionList.appendChild(li);
  }

  renderQuestionWorkspace();
}

function renderQuestionWorkspace() {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion) {
    questionWorkspace.hidden = true;
    questionEmpty.hidden = false;
    questionWarnings.replaceChildren();
    supportingFacts.replaceChildren();
    answerEditor.value = '';
    updateButtons();
    return;
  }

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  const selectedDraft = entry.drafts.find((draft) => draft.tone === entry.selectedTone) || entry.drafts[0] || null;
  const combinedWarnings = [...(entry.warnings || []), ...(selectedDraft?.warnings || [])];

  questionWorkspace.hidden = false;
  questionEmpty.hidden = true;
  questionWorkspaceTitle.textContent = selectedQuestion.questionText;
  questionWorkspaceMeta.textContent = [
    entry.classification?.type || selectedQuestion.typeHint || 'other',
    selectedQuestion.sectionHeading || '',
    selectedDraft ? `${Math.round((selectedDraft.confidence ?? 0) * 100)}% grounded confidence` : '',
    entry.savedAt ? `Saved ${entry.savedAt}` : '',
  ].filter(Boolean).join(' | ');

  for (const button of toneButtons.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.tone === entry.selectedTone);
  }

  if (document.activeElement !== answerEditor) {
    answerEditor.value = entry.editorText || selectedDraft?.answer || '';
  }

  questionWarnings.replaceChildren();
  if (combinedWarnings.length > 0) {
    for (const warning of combinedWarnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      questionWarnings.appendChild(item);
    }
  }

  supportingFacts.replaceChildren();
  const facts = selectedDraft?.sourceFactsUsed || [];
  for (const fact of facts) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = fact.title;
    const detail = document.createElement('p');
    detail.textContent = fact.detail;
    item.append(title, detail);
    supportingFacts.appendChild(item);
  }

  updateButtons();
}

async function suggestAnswers(questionId) {
  const question = getVisibleQuestions(state.context).find((item) => getQuestionKey(item) === questionId);
  if (!question) {
    setQuestionStatus('That detected question is no longer available on the page.');
    return;
  }

  state.questions.selectedId = questionId;
  const entry = getQuestionEntry(questionId);
  entry.loading = true;
  renderQuestions();
  renderQuestionWorkspace();
  updateButtons();
  setQuestionStatus('Generating grounded drafts for the selected question...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SUGGEST_QUESTION_ANSWERS',
      payload: {
        selectedTone: entry.selectedTone,
        question: {
          id: question.id,
          questionText: question.questionText,
          helperText: question.helperText || [],
          typeHint: question.typeHint,
          answerMode: question.answerMode,
          sectionHeading: question.sectionHeading,
        },
        context: {
          sourceUrl: state.context?.url,
          platform: state.context?.classification?.platform,
          pageKind: state.context?.classification?.pageKind,
          visibleTitle: state.context?.visibleTitle,
          companyName: state.context?.metadata?.companyName,
          roleTitle: state.context?.metadata?.roleTitle,
          location: state.context?.metadata?.location,
          jobDescription: state.context?.jobDescription?.text,
        },
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to generate answer drafts');
    }

    const payload = response.payload;
    entry.questionId = payload.questionId;
    entry.classification = payload.classification;
    entry.drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
    entry.warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    entry.selectedTone = payload.suggestedTone || entry.selectedTone;
    const preferredDraft = entry.drafts.find((draft) => draft.tone === entry.selectedTone) || entry.drafts[0];
    entry.editorText = preferredDraft?.answer || '';
    entry.savedAt = null;

    if (entry.drafts.length > 0) {
      setQuestionStatus(`Generated ${entry.drafts.length} grounded draft${entry.drafts.length === 1 ? '' : 's'}. Review before you insert anything.`);
    } else {
      setQuestionStatus(entry.warnings[0] || 'This question should be answered manually.');
    }
  } catch (error) {
    entry.warnings = [error instanceof Error ? error.message : 'Failed to generate answer drafts'];
    setQuestionStatus(entry.warnings[0]);
  } finally {
    entry.loading = false;
    renderQuestions();
    renderQuestionWorkspace();
    updateButtons();
  }
}

function selectQuestion(questionId) {
  state.questions.selectedId = questionId;
  renderQuestions();
  renderQuestionWorkspace();
  updateButtons();
}

function setTone(tone) {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion) return;

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  entry.selectedTone = tone;
  const matchingDraft = entry.drafts.find((draft) => draft.tone === tone);
  if (matchingDraft) {
    entry.editorText = matchingDraft.answer;
  }

  renderQuestionWorkspace();
}

async function copyAnswer() {
  const value = answerEditor.value.trim();
  if (!value) return;

  await navigator.clipboard.writeText(value);
  setQuestionStatus('Copied the reviewed answer to your clipboard.');
}

async function insertAnswer() {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion?.locator) {
    setQuestionStatus('This question field is no longer available to insert into.');
    return;
  }

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  const selectedDraft = entry.drafts.find((draft) => draft.tone === entry.selectedTone) || entry.drafts[0];

  setQuestionStatus('Inserting the reviewed answer into the page...');
  const response = await chrome.runtime.sendMessage({
    type: 'INSERT_QUESTION_ANSWER',
    payload: {
      locator: selectedQuestion.locator,
      inputType: selectedQuestion.answerMode === 'short_text' ? 'text' : 'textarea',
      fieldLabel: selectedQuestion.questionText,
      answer: answerEditor.value.trim(),
      confidence: selectedDraft?.confidence ?? 0.7,
    },
  });

  if (!response?.ok) {
    setQuestionStatus(response?.error || 'Failed to insert the selected answer.');
    return;
  }

  state.hasUndo = Boolean(response.hasUndo);
  updateButtons();
  setQuestionStatus(`Inserted the answer into "${selectedQuestion.questionText}". You can still edit it on the page or undo the last fill run.`);
}

async function saveAnswer() {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion) return;

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  if (!entry.questionId) {
    setQuestionStatus('Generate drafts for this question first so there is a saved backend record to update.');
    return;
  }

  entry.saving = true;
  updateButtons();
  setQuestionStatus('Saving your edited answer...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_QUESTION_ANSWER',
      payload: {
        questionId: entry.questionId,
        finalAnswer: answerEditor.value.trim(),
        selectedTone: entry.selectedTone,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to save the drafted answer');
    }

    entry.savedAt = new Date(response.payload.savedAt).toLocaleString();
    setQuestionStatus('Saved this answer to the application question record for later reuse.');
  } catch (error) {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to save the drafted answer.');
  } finally {
    entry.saving = false;
    renderQuestions();
    renderQuestionWorkspace();
    updateButtons();
  }
}

planFillButton.addEventListener('click', () => {
  planAutofill();
});

applyFillButton.addEventListener('click', () => {
  applyFill();
});

undoFillButton.addEventListener('click', () => {
  undoLastFill();
});

planList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const actionId = target.dataset.actionId;
  if (!actionId) return;

  runSingleAction(actionId);
});

questionList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const questionId = target.dataset.questionId;
  const action = target.dataset.action;
  if (!questionId || !action) return;

  if (action === 'select') {
    selectQuestion(questionId);
    return;
  }

  if (action === 'suggest') {
    suggestAnswers(questionId);
  }
});

toneButtons.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const tone = target.dataset.tone;
  if (!tone) return;
  setTone(tone);
});

answerEditor.addEventListener('input', () => {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion) return;

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  entry.editorText = answerEditor.value;
  updateButtons();
});

copyAnswerButton.addEventListener('click', () => {
  copyAnswer().catch((error) => {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to copy the selected answer.');
  });
});

insertAnswerButton.addEventListener('click', () => {
  insertAnswer().catch((error) => {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to insert the selected answer.');
  });
});

saveAnswerButton.addEventListener('click', () => {
  saveAnswer().catch((error) => {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to save the drafted answer.');
  });
});

refreshContext().then(() => {
  setStatus('Safe autofill is ready to preview once profile data loads.');
  setQuestionStatus('Detected long-form questions will show up here for grounded draft answers.');
});
window.setInterval(refreshContext, 2000);
