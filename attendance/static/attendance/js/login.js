document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;

      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';

      const icon = btn.querySelector('i');
      icon.classList.toggle('bi-eye', !show);
      icon.classList.toggle('bi-eye-slash', show);

      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });
  });
});