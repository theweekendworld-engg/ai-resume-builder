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
const workspaceStatus = document.getElementById('workspace-status');
const workspaceStage = document.getElementById('workspace-stage');
const workspaceQuestionProgress = document.getElementById('workspace-question-progress');
const analyzeJobButton = document.getElementById('analyze-job');
const analysisStatus = document.getElementById('analysis-status');
const analysisFitScore = document.getElementById('analysis-fit-score');
const analysisNextAction = document.getElementById('analysis-next-action');
const analysisSummary = document.getElementById('analysis-summary');
const analysisStrengths = document.getElementById('analysis-strengths');
const analysisGaps = document.getElementById('analysis-gaps');

const generateResumeButton = document.getElementById('generate-resume');
const openResumeEditorButton = document.getElementById('open-resume-editor');
const downloadResumePdfButton = document.getElementById('download-resume-pdf');
const useResumeUploadButton = document.getElementById('use-resume-upload');
const resumeStatus = document.getElementById('resume-status');
const resumeStage = document.getElementById('resume-stage');
const resumeAts = document.getElementById('resume-ats');
const resumeProgress = document.getElementById('resume-progress');
const usePreviousAnswerButton = document.getElementById('use-previous-answer');
const saveReusableAnswerButton = document.getElementById('save-reusable-answer');
const alwaysReuseAnswerButton = document.getElementById('always-reuse-answer');
const questionMemoryNote = document.getElementById('question-memory-note');
const refreshCompanyInsightButton = document.getElementById('refresh-company-insight');
const companyStatus = document.getElementById('company-status');
const companyConfidence = document.getElementById('company-confidence');
const companyFitScore = document.getElementById('company-fit-score');
const companyFacts = document.getElementById('company-facts');
const companyInterpretation = document.getElementById('company-interpretation');

const state = {
  context: null,
  bundle: null,
  plan: null,
  hasUndo: false,
  actionResults: {},
  workspace: {
    item: null,
    syncSignature: '',
    loading: false,
    lastMatchedBy: null,
  },
  analysis: {
    loading: false,
    signature: '',
    result: null,
  },
  resume: {
    session: null,
    polling: false,
  },
  company: {
    loading: false,
    insight: null,
    signature: '',
  },
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

function setWorkspaceStatus(message) {
  workspaceStatus.textContent = message;
}

function setAnalysisStatus(message) {
  analysisStatus.textContent = message;
}

function setResumeStatus(message) {
  resumeStatus.textContent = message;
}

function setCompanyStatus(message) {
  companyStatus.textContent = message;
}

function formatWorkspaceStage(status) {
  return String(status || 'not_saved')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRecommendedNextAction(action) {
  const labels = {
    fill_basics: 'Fill Basics',
    tailor_resume: 'Tailor Resume',
    review_before_applying: 'Review Carefully',
  };

  return labels[action] || '--';
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

function canCreateWorkspace(context) {
  if (!context?.url) return false;
  if (context.classification?.pageKind === 'unsupported' || context.classification?.pageKind === 'auth_gate') {
    return false;
  }

  return Boolean(
    context.metadata?.roleTitle
    || context.metadata?.companyName
    || context.jobDescription?.text
    || getVisibleQuestions(context).length > 0
    || (context.stats?.visibleFieldCount ?? 0) > 0
  );
}

function buildWorkspacePayload(context) {
  return {
    workspaceId: state.workspace.item?.id || undefined,
    sourcePlatform: context?.classification?.platform,
    sourceUrl: context?.url,
    companyName: context?.metadata?.companyName,
    roleTitle: context?.metadata?.roleTitle || context?.heading || context?.visibleTitle,
    location: context?.metadata?.location,
    employmentType: context?.metadata?.employmentType,
    compensationText: context?.metadata?.compensationText,
    jobDescription: context?.jobDescription?.text,
    applicationStatus: getVisibleQuestions(context).length > 0 ? 'in_progress' : 'discovered',
  };
}

function getWorkspaceSignature(context) {
  if (!canCreateWorkspace(context)) return '';

  return JSON.stringify({
    workspaceId: state.workspace.item?.id || '',
    sourceUrl: context?.url || '',
    sourcePlatform: context?.classification?.platform || '',
    companyName: context?.metadata?.companyName || '',
    roleTitle: context?.metadata?.roleTitle || context?.heading || context?.visibleTitle || '',
    location: context?.metadata?.location || '',
    jobDescriptionSample: context?.jobDescription?.text?.slice(0, 240) || '',
    questionCount: getVisibleQuestions(context).length,
  });
}

function renderWorkspace() {
  const workspace = state.workspace.item;
  if (!workspace) {
    workspaceStage.textContent = 'Not saved';
    workspaceQuestionProgress.textContent = '0/0';
    setWorkspaceStatus(canCreateWorkspace(state.context)
      ? 'We have enough page context to save this as an application workspace.'
      : 'We will save this job page as an application workspace once enough context is available.');
    return;
  }

  workspaceStage.textContent = formatWorkspaceStage(workspace.applicationStatus);
  workspaceQuestionProgress.textContent = `${workspace.answeredQuestionCount || 0}/${workspace.questionCount || 0}`;

  const parts = [
    workspace.companyName,
    workspace.roleTitle,
    typeof workspace.fitScore === 'number' ? `fit ${workspace.fitScore}%` : '',
    state.workspace.lastMatchedBy ? `matched by ${state.workspace.lastMatchedBy.replace('_', ' ')}` : '',
    workspace.updatedAt ? `updated ${new Date(workspace.updatedAt).toLocaleString()}` : '',
  ].filter(Boolean);
  setWorkspaceStatus(parts.join(' | '));
}

function renderAnalysis() {
  const result = state.analysis.result;
  const workspace = state.workspace.item;

  if (!result) {
    analysisFitScore.textContent = typeof workspace?.fitScore === 'number' ? `${workspace.fitScore}%` : '--';
    analysisNextAction.textContent = '--';
    analysisSummary.textContent = workspace?.fitSummary
      || 'Analysis summary will appear here after you run it.';
    renderInsightList(
      analysisStrengths,
      [],
      workspace?.fitSummary
        ? 'Run analysis again to refresh detailed strengths for this page.'
        : 'Role strengths will appear here after analysis runs.'
    );
    renderInsightList(
      analysisGaps,
      [],
      workspace?.fitSummary
        ? 'Run analysis again to refresh missing-skill detail for this page.'
        : 'Likely gaps and risks will appear here after analysis runs.'
    );
    setAnalysisStatus(state.context?.jobDescription?.text
      ? 'Run job analysis to score fit, surface strengths, and flag missing requirements from the parsed JD.'
      : 'This page needs a parsed job description before fit analysis can run.');
    return;
  }

  analysisFitScore.textContent = `${result.fitScore}%`;
  analysisNextAction.textContent = formatRecommendedNextAction(result.recommendedNextAction);
  analysisSummary.textContent = result.summary;
  renderInsightList(analysisStrengths, result.strengths ?? [], 'No strong fit signals were recovered from the saved profile.');
  renderInsightList(analysisGaps, result.gaps ?? [], 'No major gaps were flagged by the current analysis.');
  setAnalysisStatus('Analysis is up to date for the current page snapshot.');
}

function renderResumeGeneration() {
  const session = state.resume.session;
  if (!session) {
    resumeStage.textContent = 'Idle';
    resumeAts.textContent = '--';
    resumeProgress.style.width = '0%';
    setResumeStatus(state.workspace.item?.jobDescription
      ? 'This workspace is ready for tailored resume generation from the browser.'
      : 'Generate a tailored resume once this workspace has a saved job description.');
    updateButtons();
    return;
  }

  resumeStage.textContent = session.stageLabel || session.currentStep || 'Preparing';
  resumeAts.textContent = typeof session.atsScore === 'number' ? `${session.atsScore}%` : '--';
  resumeProgress.style.width = `${Math.max(0, Math.min(100, session.progressPercent || 0))}%`;

  const parts = [
    session.status,
    session.errorMessage || '',
    session.resumeId ? 'resume ready' : '',
    session.pdfUrl ? 'pdf ready' : '',
  ].filter(Boolean);
  setResumeStatus(parts.join(' | '));
  updateButtons();
}

function renderInsightList(target, items, emptyMessage) {
  target.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    const item = document.createElement('li');
    item.textContent = emptyMessage;
    target.appendChild(item);
    return;
  }

  for (const entry of items) {
    const item = document.createElement('li');
    item.textContent = entry;
    target.appendChild(item);
  }
}

function renderCompanyInsight() {
  const insight = state.company.insight;
  if (!insight) {
    companyConfidence.textContent = '--';
    companyFitScore.textContent = '--';
    renderInsightList(companyFacts, [], 'Saved company facts will appear here once we have enough context.');
    renderInsightList(companyInterpretation, [], 'Interpretation notes will appear here after analysis runs.');
    setCompanyStatus(state.workspace.item?.companyName
      ? 'Refresh to pull the latest company trust and fit read for this workspace.'
      : 'Company intelligence needs a saved workspace with a detected company name.');
    return;
  }

  companyConfidence.textContent = `${Math.round((insight.insight?.confidence ?? 0) * 100)}%`;
  companyFitScore.textContent = typeof insight.fit?.fitScore === 'number' ? `${insight.fit.fitScore}%` : '--';
  renderInsightList(companyFacts, insight.insight?.facts ?? [], 'No structured company facts were found on this page.');
  renderInsightList(companyInterpretation, insight.insight?.interpretation ?? [], 'Interpretation remains limited because the page exposed little reliable signal.');
  setCompanyStatus([
    insight.insight?.freshnessLabel,
    insight.insight?.sourceSummary,
  ].filter(Boolean).join(' | '));
}

async function syncWorkspaceIfNeeded(force = false) {
  if (!canCreateWorkspace(state.context)) {
    state.workspace.item = null;
    state.workspace.syncSignature = '';
    state.workspace.lastMatchedBy = null;
    renderWorkspace();
    return null;
  }

  const nextSignature = getWorkspaceSignature(state.context);
  if (!force && nextSignature && nextSignature === state.workspace.syncSignature) {
    return state.workspace.item;
  }

  state.workspace.loading = true;
  setWorkspaceStatus('Saving the current job page into an application workspace...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPSERT_WORKSPACE',
      payload: buildWorkspacePayload(state.context),
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to sync the application workspace');
    }

    state.workspace.item = response.payload.workspace;
    state.workspace.syncSignature = nextSignature;
    state.workspace.lastMatchedBy = response.payload.matchedBy;
    renderWorkspace();
    return state.workspace.item;
  } catch (error) {
    state.workspace.syncSignature = '';
    setWorkspaceStatus(error instanceof Error ? error.message : 'Failed to sync the application workspace.');
    return null;
  } finally {
    state.workspace.loading = false;
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
      reusableAnswer: null,
      preferenceAnswer: null,
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
  analyzeJobButton.disabled = !state.context?.jobDescription?.text || state.analysis.loading;

  const selectedQuestion = getSelectedQuestion();
  const selectedEntry = selectedQuestion ? getQuestionEntry(getQuestionKey(selectedQuestion)) : null;
  const hasAnswer = Boolean(answerEditor.value.trim());
  copyAnswerButton.disabled = !hasAnswer;
  insertAnswerButton.disabled = !selectedQuestion?.locator || !hasAnswer || Boolean(selectedEntry?.loading);
  saveAnswerButton.disabled = !selectedEntry?.questionId || !hasAnswer || Boolean(selectedEntry?.saving);
  usePreviousAnswerButton.disabled = !selectedEntry?.reusableAnswer;
  saveReusableAnswerButton.disabled = !selectedEntry?.questionId || !hasAnswer || Boolean(selectedEntry?.saving);
  alwaysReuseAnswerButton.disabled = !selectedEntry?.questionId || !hasAnswer || Boolean(selectedEntry?.saving);

  const activeSession = state.resume.session;
  const hasGeneratedResume = Boolean(activeSession?.resumeId);
  const hasPdf = Boolean(activeSession?.pdfUrl);
  generateResumeButton.disabled = !state.workspace.item?.id || !state.workspace.item?.jobDescription || state.resume.polling;
  openResumeEditorButton.disabled = !hasGeneratedResume;
  downloadResumePdfButton.disabled = !hasPdf;
  useResumeUploadButton.disabled = !hasPdf;
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
    renderWorkspace();
    renderAnalysis();
    renderResumeGeneration();
    renderCompanyInsight();
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
  renderWorkspace();
  renderAnalysis();
  renderResumeGeneration();
  renderCompanyInsight();
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

function getAnalysisSignature(context) {
  return JSON.stringify({
    url: context?.url || '',
    roleTitle: context?.metadata?.roleTitle || '',
    companyName: context?.metadata?.companyName || '',
    location: context?.metadata?.location || '',
    jobDescriptionSample: context?.jobDescription?.text?.slice(0, 240) || '',
  });
}

function buildAnalysisPayload(context) {
  return {
    url: context?.url,
    platformHint: context?.classification?.platform,
    pageKindHint: context?.classification?.pageKind,
    visibleTitle: context?.visibleTitle,
    companyName: context?.metadata?.companyName,
    roleTitle: context?.metadata?.roleTitle,
    location: context?.metadata?.location,
    metadata: context?.metadata,
    jobDescription: context?.jobDescription?.text,
    extractedJobDescription: context?.jobDescription,
    normalizedPage: context,
    fields: Array.isArray(context?.fields) ? context.fields : [],
    questions: getVisibleQuestions(context).map((question) => ({
      label: question.questionText,
      typeHint: question.typeHint,
    })),
  };
}

async function persistAnalysisResult(result) {
  const workspace = state.workspace.item || await syncWorkspaceIfNeeded();
  if (!workspace?.id) return;

  const response = await chrome.runtime.sendMessage({
    type: 'UPSERT_WORKSPACE',
    payload: {
      workspaceId: workspace.id,
      sourcePlatform: state.context?.classification?.platform,
      sourceUrl: state.context?.url,
      companyName: result.metadata?.companyName || workspace.companyName || state.context?.metadata?.companyName,
      roleTitle: result.metadata?.roleTitle || workspace.roleTitle || state.context?.metadata?.roleTitle,
      location: result.metadata?.location || workspace.location || state.context?.metadata?.location,
      employmentType: state.context?.metadata?.employmentType || workspace.employmentType,
      compensationText: state.context?.metadata?.compensationText || workspace.compensationText,
      jobDescription: state.context?.jobDescription?.text || workspace.jobDescription,
      applicationStatus: getVisibleQuestions(state.context).length > 0 ? 'in_progress' : 'analyzed',
      fitScore: result.fitScore,
      fitSummary: result.summary,
    },
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to persist the analysis into the application workspace');
  }

  state.workspace.item = response.payload.workspace;
  state.workspace.lastMatchedBy = response.payload.matchedBy;
  renderWorkspace();
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
    state.workspace.item = null;
    state.workspace.syncSignature = '';
    state.workspace.lastMatchedBy = null;
    state.analysis.result = null;
    state.analysis.signature = '';
    state.analysis.loading = false;
    state.resume.session = null;
    state.resume.polling = false;
    state.company.insight = null;
    state.company.signature = '';
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
    state.analysis.result = null;
    state.analysis.signature = '';
  }

  pruneQuestionState();
  renderContext(state.context);
  renderPlan(state.plan);
  renderQuestionWorkspace();
  const workspace = await syncWorkspaceIfNeeded();
  if (workspace?.latestGenerationSessionId) {
    await pollGenerationStatus(workspace.latestGenerationSessionId, workspace.id, false);
  } else if (!workspace) {
    state.resume.session = null;
  }
  await maybeRefreshCompanyInsight(false);
  renderAnalysis();
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
    questionMemoryNote.textContent = '';
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

  questionMemoryNote.textContent = [
    entry.preferenceAnswer ? `${entry.preferenceAnswer.label}: ${entry.preferenceAnswer.sourceSummary}` : '',
    entry.reusableAnswer ? `Reusable answer available (${entry.reusableAnswer.usageCount || 0} prior use${entry.reusableAnswer.usageCount === 1 ? '' : 's'}).` : '',
  ].filter(Boolean).join(' | ');

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
    const workspace = await syncWorkspaceIfNeeded();
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
          workspaceId: workspace?.id || state.workspace.item?.id,
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
    entry.reusableAnswer = payload.reusableAnswer || null;
    entry.preferenceAnswer = payload.preferenceAnswer || null;
    entry.selectedTone = payload.suggestedTone || entry.selectedTone;
    const preferredDraft = entry.drafts.find((draft) => draft.tone === entry.selectedTone) || entry.drafts[0];
    entry.editorText = entry.reusableAnswer?.autoUse
      ? entry.reusableAnswer.answerText
      : preferredDraft?.answer || '';
    entry.savedAt = null;

    if (entry.drafts.length > 0) {
      setQuestionStatus(`Generated ${entry.drafts.length} grounded draft${entry.drafts.length === 1 ? '' : 's'}. Review before you insert anything.`);
    } else if (entry.reusableAnswer) {
      setQuestionStatus('A reusable answer is available for this question. Review it before inserting.');
    } else {
      setQuestionStatus(entry.warnings[0] || 'This question should be answered manually.');
    }
    await syncWorkspaceIfNeeded(true);
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

async function saveAnswer(options = {}) {
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
        saveAsReusable: Boolean(options.saveAsReusable),
        alwaysUseForSimilar: Boolean(options.alwaysUseForSimilar),
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to save the drafted answer');
    }

    entry.savedAt = new Date(response.payload.savedAt).toLocaleString();
    if (response.payload.reusableAnswerSaved) {
      entry.reusableAnswer = {
        id: response.payload.reusableAnswerId,
        canonicalQuestion: selectedQuestion.questionText,
        answerText: answerEditor.value.trim(),
        usageCount: (entry.reusableAnswer?.usageCount || 0) + 1,
        autoUse: Boolean(options.alwaysUseForSimilar) || Boolean(entry.reusableAnswer?.autoUse),
        matchReason: 'Saved from your accepted answer.',
      };
    }

    setQuestionStatus(response.payload.reusableAnswerSaved
      ? 'Saved this answer and added it to reusable memory for similar questions.'
      : 'Saved this answer to the application question record for later reuse.');
    await syncWorkspaceIfNeeded(true);
  } catch (error) {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to save the drafted answer.');
  } finally {
    entry.saving = false;
    renderQuestions();
    renderQuestionWorkspace();
    updateButtons();
  }
}

function usePreviousAnswer() {
  const selectedQuestion = getSelectedQuestion();
  if (!selectedQuestion) return;

  const entry = getQuestionEntry(getQuestionKey(selectedQuestion));
  if (!entry.reusableAnswer) {
    setQuestionStatus('No reusable answer is available for this question yet.');
    return;
  }

  entry.editorText = entry.reusableAnswer.answerText;
  answerEditor.value = entry.editorText;
  renderQuestionWorkspace();
  setQuestionStatus('Loaded your previous accepted answer into the editor.');
}

async function analyzeCurrentJob() {
  if (!state.context?.jobDescription?.text) {
    setAnalysisStatus('This page needs a parsed job description before fit analysis can run.');
    return;
  }

  state.analysis.loading = true;
  updateButtons();
  setAnalysisStatus('Analyzing the current job against your saved profile...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_PAGE_CONTEXT',
      payload: buildAnalysisPayload(state.context),
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to analyze the current page');
    }

    state.analysis.result = response.payload;
    state.analysis.signature = getAnalysisSignature(state.context);
    renderAnalysis();
    await persistAnalysisResult(response.payload);
    setAnalysisStatus('Analysis complete and synced into the application workspace.');
  } catch (error) {
    setAnalysisStatus(error instanceof Error ? error.message : 'Failed to analyze the current page.');
  } finally {
    state.analysis.loading = false;
    renderAnalysis();
    updateButtons();
  }
}

function getCompanyInsightSignature() {
  const workspace = state.workspace.item;
  if (!workspace?.companyName) return '';

  return JSON.stringify({
    workspaceId: workspace.id,
    companyName: workspace.companyName,
    roleTitle: workspace.roleTitle,
    sourceUrl: workspace.sourceUrl,
    jobDescriptionSample: workspace.jobDescription?.slice(0, 160) || '',
  });
}

async function maybeRefreshCompanyInsight(force = false) {
  const workspace = state.workspace.item;
  if (!workspace?.companyName) {
    state.company.insight = null;
    state.company.signature = '';
    renderCompanyInsight();
    return;
  }

  const signature = getCompanyInsightSignature();
  if (!force && signature && signature === state.company.signature) {
    renderCompanyInsight();
    return;
  }

  state.company.loading = true;
  setCompanyStatus('Refreshing company trust and fit signals...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_COMPANY_INSIGHT',
      payload: {
        workspaceId: workspace.id,
        companyName: workspace.companyName,
        roleTitle: workspace.roleTitle,
        sourceUrl: workspace.sourceUrl,
        jobDescription: workspace.jobDescription,
        forceRefresh: force,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load company insight');
    }

    state.company.insight = response.payload;
    state.company.signature = signature;
    if (response.payload.workspace) {
      state.workspace.item = response.payload.workspace;
      renderWorkspace();
      renderAnalysis();
    }
    renderCompanyInsight();
  } catch (error) {
    setCompanyStatus(error instanceof Error ? error.message : 'Failed to load company insight.');
  } finally {
    state.company.loading = false;
  }
}

async function pollGenerationStatus(sessionId, workspaceId, announce = true) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_GENERATION_STATUS',
      sessionId,
      workspaceId,
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load generation status');
    }

    state.resume.session = response.payload.session;
    state.resume.polling = ['pending', 'generating'].includes(response.payload.session.status);
    if (response.payload.workspace) {
      state.workspace.item = response.payload.workspace;
      renderWorkspace();
    }

    if (announce) {
      if (response.payload.session.status === 'completed') {
        setResumeStatus('Tailored resume is ready. You can open it in the editor, download the PDF, or use it for upload.');
      } else if (response.payload.session.status === 'failed') {
        setResumeStatus(response.payload.session.errorMessage || 'Resume generation failed.');
      }
    }

    renderResumeGeneration();
  } catch (error) {
    state.resume.polling = false;
    setResumeStatus(error instanceof Error ? error.message : 'Failed to load generation status.');
  }
}

async function generateResume() {
  const workspace = state.workspace.item || await syncWorkspaceIfNeeded();
  if (!workspace?.id) {
    setResumeStatus('Save this page as an application workspace first.');
    return;
  }

  if (!workspace.jobDescription) {
    setResumeStatus('This page needs a parsed job description before resume generation can start.');
    return;
  }

  state.resume.polling = true;
  setResumeStatus('Starting tailored resume generation...');
  updateButtons();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_RESUME_GENERATION',
      payload: {
        workspaceId: workspace.id,
        sourceResumeId: workspace.selectedResumeId || undefined,
        companyName: workspace.companyName || undefined,
        roleTitle: workspace.roleTitle || undefined,
        sourceUrl: workspace.sourceUrl,
        jobDescription: workspace.jobDescription,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to start resume generation');
    }

    state.resume.session = response.payload.session;
    if (response.payload.workspace) {
      state.workspace.item = response.payload.workspace;
      renderWorkspace();
    }
    renderResumeGeneration();
    setResumeStatus('Resume generation is underway. Progress will keep updating here.');
  } catch (error) {
    state.resume.polling = false;
    setResumeStatus(error instanceof Error ? error.message : 'Failed to start resume generation.');
  } finally {
    updateButtons();
  }
}

async function openUrl(url) {
  if (!url) return;
  const response = await chrome.runtime.sendMessage({
    type: 'OPEN_URL',
    url,
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to open the requested URL');
  }
}

function getUploadTarget() {
  if (state.plan?.actions?.some((action) => action.action === 'manual_upload')) {
    return state.plan.actions.find((action) => action.action === 'manual_upload');
  }

  const fileField = state.context?.fields?.find((field) => field.inputType === 'file');
  if (!fileField) return null;

  return {
    locator: fileField.locator,
    fieldLabel: fileField.label,
  };
}

async function useResumeForUpload() {
  const session = state.resume.session;
  if (!session?.pdfUrl) {
    setResumeStatus('Generate a PDF first so it can be used for upload.');
    return;
  }

  const uploadTarget = getUploadTarget();
  if (!uploadTarget?.locator) {
    setResumeStatus('No upload field is visible on this page yet. Download the PDF first, then use it in the site picker.');
    await openUrl(session.pdfUrl);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'FOCUS_FIELD',
    locator: uploadTarget.locator,
  });

  if (!response?.ok) {
    setResumeStatus(response?.error || 'Failed to focus the upload field.');
    return;
  }

  await openUrl(session.pdfUrl);
  setResumeStatus('Opened the resume PDF and focused the upload field. Download the PDF if needed, then choose it in the picker.');
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

usePreviousAnswerButton.addEventListener('click', () => {
  usePreviousAnswer();
});

saveReusableAnswerButton.addEventListener('click', () => {
  saveAnswer({ saveAsReusable: true }).catch((error) => {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to save the reusable answer.');
  });
});

alwaysReuseAnswerButton.addEventListener('click', () => {
  saveAnswer({ saveAsReusable: true, alwaysUseForSimilar: true }).catch((error) => {
    setQuestionStatus(error instanceof Error ? error.message : 'Failed to save the reusable answer.');
  });
});

analyzeJobButton.addEventListener('click', () => {
  analyzeCurrentJob().catch((error) => {
    setAnalysisStatus(error instanceof Error ? error.message : 'Failed to analyze the current job.');
  });
});

generateResumeButton.addEventListener('click', () => {
  generateResume().catch((error) => {
    setResumeStatus(error instanceof Error ? error.message : 'Failed to start resume generation.');
  });
});

openResumeEditorButton.addEventListener('click', () => {
  openUrl(state.resume.session?.editorUrl).catch((error) => {
    setResumeStatus(error instanceof Error ? error.message : 'Failed to open the generated resume.');
  });
});

downloadResumePdfButton.addEventListener('click', () => {
  openUrl(state.resume.session?.pdfUrl).catch((error) => {
    setResumeStatus(error instanceof Error ? error.message : 'Failed to open the generated PDF.');
  });
});

useResumeUploadButton.addEventListener('click', () => {
  useResumeForUpload().catch((error) => {
    setResumeStatus(error instanceof Error ? error.message : 'Failed to prepare the resume for upload.');
  });
});

refreshCompanyInsightButton.addEventListener('click', () => {
  maybeRefreshCompanyInsight(true).catch((error) => {
    setCompanyStatus(error instanceof Error ? error.message : 'Failed to refresh company insight.');
  });
});

refreshContext().then(() => {
  setStatus('Safe autofill is ready to preview once profile data loads.');
  setQuestionStatus('Detected long-form questions will show up here for grounded draft answers.');
  setAnalysisStatus('Run job analysis to score fit, surface strengths, and flag missing requirements from the parsed JD.');
  setResumeStatus('Generate a tailored resume once this page has enough saved workspace context.');
  setCompanyStatus('Company trust and fit signals will appear here after workspace sync.');
});
window.setInterval(refreshContext, 2000);
