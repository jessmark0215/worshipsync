// ============================================================
// WORSHIPSYNC · js/shared/ui.js
// Shared UI helpers — used by every page.
// ============================================================

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => root.querySelectorAll(s);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const uid = () => 'id_' + Math.random().toString(36).slice(2, 9);

// ============================================================
// TOAST
// ============================================================
let toastTimer;
export function showToast(text, isError = false) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.innerHTML = `<i data-lucide="${isError ? 'circle-alert' : 'check-circle-2'}"></i>${esc(text)}`;
  document.body.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

// ============================================================
// MODAL
// ============================================================
export function openModal(htmlContent, { wide = false, onBind } = {}) {
  closeModal();

  const root = document.createElement('div');
  root.id = 'modalRoot';
  root.innerHTML = `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal ${wide ? 'modal-wide' : ''}"></div>
    </div>
  `;
  const inner = root.querySelector('.modal');
  inner.innerHTML = htmlContent;
  inner.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(root);

  // Close handlers
  root.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', closeModal);
  });

  if (window.lucide) window.lucide.createIcons();
  if (typeof onBind === 'function') onBind(inner);
}

export function closeModal() {
  const old = document.getElementById('modalRoot');
  if (old) old.remove();
}

// ESC closes modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modalRoot')) {
    closeModal();
  }
});
