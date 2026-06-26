const CREATE_KEY = 'sublimilou-draft-create';
const IMPORT_KEY = 'sublimilou-draft-import';
export const RESUME_VIEW_KEY = 'sublimilou-resume-view';

const FORM_VIEWS = new Set(['create', 'import']);

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function isFormView(view) {
  return FORM_VIEWS.has(view);
}

export function persistResumeView(view) {
  if (FORM_VIEWS.has(view)) write(RESUME_VIEW_KEY, view);
  else remove(RESUME_VIEW_KEY);
}

export function readResumeView() {
  const view = read(RESUME_VIEW_KEY);
  return FORM_VIEWS.has(view) ? view : null;
}

export function readCreateDraft() {
  return read(CREATE_KEY);
}

export function writeCreateDraft(data) {
  if (!data?.url && !data?.title && !data?.affirmations && !data?.tags?.length) {
    remove(CREATE_KEY);
    return;
  }
  write(CREATE_KEY, data);
}

export function clearCreateDraft() {
  remove(CREATE_KEY);
}

export function readImportDraft() {
  return read(IMPORT_KEY);
}

export function writeImportDraft(data) {
  if (!data?.url && !data?.tags?.length) {
    remove(IMPORT_KEY);
    return;
  }
  write(IMPORT_KEY, data);
}

export function clearImportDraft() {
  remove(IMPORT_KEY);
}

export function collectCreateDraft(getTags) {
  return {
    url: document.querySelector('#create-youtube-url')?.value || '',
    title: document.querySelector('#create-title')?.value || '',
    affirmations: document.querySelector('#create-affirmations')?.value || '',
    tags: getTags?.() || [],
  };
}

export function applyCreateDraft(draft, setTags) {
  if (!draft) return;
  const urlEl = document.querySelector('#create-youtube-url');
  const titleEl = document.querySelector('#create-title');
  const affEl = document.querySelector('#create-affirmations');
  if (urlEl && draft.url) urlEl.value = draft.url;
  if (titleEl && draft.title) titleEl.value = draft.title;
  if (affEl && draft.affirmations) affEl.value = draft.affirmations;
  if (draft.tags?.length) setTags?.(draft.tags);
}

export function collectImportDraft(getTags) {
  return {
    url: document.querySelector('#youtube-url')?.value || '',
    tags: getTags?.() || [],
  };
}

export function applyImportDraft(draft, setTags) {
  if (!draft) return;
  const urlEl = document.querySelector('#youtube-url');
  if (urlEl && draft.url) urlEl.value = draft.url;
  if (draft.tags?.length) setTags?.(draft.tags);
}
