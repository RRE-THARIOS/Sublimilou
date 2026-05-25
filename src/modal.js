import { escapeHtml } from './utils.js';
import { $ } from './utils.js';

let activeModal = null;

function getEls() {
  return {
    root: $('#modal-root'),
    title: $('#modal-title'),
    message: $('#modal-message'),
    field: $('#modal-field'),
    input: $('#modal-input'),
    list: $('#modal-list'),
    actions: $('#modal-actions'),
    cancel: $('#modal-cancel'),
    confirm: $('#modal-confirm'),
  };
}

function resetModalLayout() {
  const els = getEls();
  els.list?.classList.add('hidden');
  els.list.innerHTML = '';
  els.actions?.classList.remove('hidden');
  els.field?.classList.remove('hidden');
  els.confirm?.classList.remove('hidden');
}

function closeModal() {
  const { root } = getEls();
  root?.classList.add('hidden');
  root?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  activeModal = null;
}

function openModal() {
  const { root } = getEls();
  root?.classList.remove('hidden');
  root?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

export function initModal() {
  const { root, cancel } = getEls();
  const dismissModal = () => {
    activeModal?.resolveCancel?.();
    closeModal();
  };
  $('#modal-backdrop')?.addEventListener('click', dismissModal);
  $('#modal-backdrop')?.addEventListener('pointerdown', dismissModal);
  getEls().root?.querySelector('.modal-card')?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  cancel?.addEventListener('click', () => {
    activeModal?.resolveCancel?.();
    closeModal();
  });
  root?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      activeModal?.resolveCancel?.();
      closeModal();
    }
  });
}

/**
 * @param {{ title: string, message?: string, placeholder?: string, defaultValue?: string, confirmLabel?: string, cancelLabel?: string }} opts
 * @returns {Promise<string|null>}
 */
/**
 * Menu custom (remplace les &lt;select&gt; natifs)
 * @param {{ title: string, message?: string, items: { id: string, label: string, disabled?: boolean, hint?: string }[], cancelLabel?: string }} opts
 * @returns {Promise<string|null>}
 */
export function showMenu(opts) {
  return new Promise((resolve) => {
    const els = getEls();
    const { title, message = '', items = [], cancelLabel = 'Fermer' } = opts;

    resetModalLayout();
    els.title.textContent = title;
    els.message.textContent = message;
    els.message.hidden = !message;
    els.field.hidden = true;
    els.confirm.classList.add('hidden');
    els.cancel.textContent = cancelLabel;

    els.list.innerHTML = items
      .map(
        (item) => `
        <li>
          <button
            type="button"
            class="modal-list-item ${item.disabled ? 'is-disabled' : ''}"
            data-menu-id="${escapeHtml(item.id)}"
            ${item.disabled ? 'disabled' : ''}
            role="option"
          >
            <span class="modal-list-label">${escapeHtml(item.label)}</span>
            ${item.hint ? `<span class="modal-list-hint">${escapeHtml(item.hint)}</span>` : ''}
          </button>
        </li>`,
      )
      .join('');
    els.list.classList.remove('hidden');

    const onPick = (id) => {
      cleanup();
      closeModal();
      resolve(id);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };

    const handlers = [];
    els.list.querySelectorAll('[data-menu-id]').forEach((btn) => {
      const fn = () => {
        if (btn.disabled) return;
        onPick(btn.dataset.menuId);
      };
      btn.addEventListener('click', fn);
      handlers.push({ btn, fn });
    });

    const onCancelClick = () => onCancel();

    const cleanup = () => {
      handlers.forEach(({ btn, fn }) => btn.removeEventListener('click', fn));
      els.cancel.removeEventListener('click', onCancelClick);
      resetModalLayout();
    };

    activeModal = { resolveCancel: onCancel };
    els.cancel.addEventListener('click', onCancelClick);

    openModal();
  });
}

export function showPrompt(opts) {
  return new Promise((resolve) => {
    resetModalLayout();
    const els = getEls();
    const {
      title,
      message = '',
      placeholder = '',
      defaultValue = '',
      confirmLabel = 'Créer',
      cancelLabel = 'Annuler',
    } = opts;

    els.title.textContent = title;
    els.message.textContent = message;
    els.message.hidden = !message;
    els.field.hidden = false;
    els.input.placeholder = placeholder;
    els.input.value = defaultValue;
    els.cancel.textContent = cancelLabel;
    els.confirm.textContent = confirmLabel;
    els.confirm.classList.remove('danger');

    const onConfirm = () => {
      const v = els.input.value.trim();
      if (!v) {
        els.input.focus();
        return;
      }
      cleanup();
      closeModal();
      resolve(v);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };

    const cleanup = () => {
      els.confirm.removeEventListener('click', onConfirm);
      els.input.removeEventListener('keydown', onEnter);
    };

    const onEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    activeModal = { resolveCancel: onCancel };
    els.confirm.addEventListener('click', onConfirm);
    els.input.addEventListener('keydown', onEnter);

    openModal();
    requestAnimationFrame(() => els.input.focus());
  });
}

/**
 * @param {{ title: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function showConfirm(opts) {
  return new Promise((resolve) => {
    resetModalLayout();
    const els = getEls();
    const {
      title,
      message = '',
      confirmLabel = 'Confirmer',
      cancelLabel = 'Annuler',
      danger = false,
    } = opts;

    els.title.textContent = title;
    els.message.textContent = message;
    els.message.hidden = !message;
    els.field.hidden = true;
    els.cancel.textContent = cancelLabel;
    els.confirm.textContent = confirmLabel;
    els.confirm.classList.toggle('danger', danger);

    const onConfirm = () => {
      cleanup();
      closeModal();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(false);
    };

    const cleanup = () => {
      els.confirm.removeEventListener('click', onConfirm);
    };

    activeModal = { resolveCancel: onCancel };
    els.confirm.addEventListener('click', onConfirm);

    openModal();
    requestAnimationFrame(() => els.confirm.focus());
  });
}
