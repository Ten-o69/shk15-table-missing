document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle-password]');
  if (!btn) return;

  const sel = btn.getAttribute('data-toggle-password');
  const input = document.querySelector(sel);
  if (!input) return;

  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';

  const icon = btn.querySelector('i');
  if (icon) {
    icon.classList.toggle('bi-eye', !show);
    icon.classList.toggle('bi-eye-slash', show);
  }

  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  input.focus({ preventScroll: true });
});