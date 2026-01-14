(function () {
  const grid = document.getElementById('students-grid');
  const clientSearch = document.getElementById('client-search');
  const selectedCountEl = document.getElementById('selected-count');
  const visibleCountEl = document.getElementById('visible-count');

  function getCards() {
    return Array.from(grid ? grid.querySelectorAll('.student-card') : []);
  }

  function updateSelectedCount() {
    const checks = document.querySelectorAll('.student-check');
    let n = 0;
    checks.forEach(cb => { if (cb.checked) n += 1; });
    if (selectedCountEl) selectedCountEl.textContent = String(n);
  }

  function updateVisibleCount() {
    const cards = getCards();
    let n = 0;
    cards.forEach(c => { if (c.style.display !== 'none') n += 1; });
    if (visibleCountEl) visibleCountEl.textContent = String(n);
  }

  if (clientSearch) {
    clientSearch.addEventListener('input', function () {
      const term = (this.value || '').trim().toLowerCase();
      getCards().forEach(card => {
        const name = card.dataset.name || '';
        const cls = card.dataset.class || '';
        const isMatch = !term || name.includes(term) || cls.includes(term);
        card.style.display = isMatch ? '' : 'none';
      });
      updateVisibleCount();
    });
  }

  function setAll(checked) {
    getCards().forEach(card => {
      if (card.style.display === 'none') return;
      const cb = card.querySelector('.student-check');
      if (cb) cb.checked = checked;
    });
    updateSelectedCount();
  }

  const checkAllBtn = document.getElementById('check-all');
  const uncheckAllBtn = document.getElementById('uncheck-all');
  if (checkAllBtn) checkAllBtn.addEventListener('click', () => setAll(true));
  if (uncheckAllBtn) uncheckAllBtn.addEventListener('click', () => setAll(false));

  document.addEventListener('change', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('student-check')) {
      updateSelectedCount();
    }
  });

  const bulkForm = document.getElementById('bulk-form');
  if (bulkForm) {
    bulkForm.addEventListener('submit', (e) => {
      const action = bulkForm.querySelector('select[name="action"]')?.value;
      const selected = document.querySelectorAll('.student-check:checked').length;

      if (!action) { e.preventDefault(); alert('Выберите действие.'); return; }
      if (selected === 0) { e.preventDefault(); alert('Выберите хотя бы одного ученика.'); return; }

      if (action === 'delete') {
        if (!confirm('Удалить выбранных учеников? Они станут неактивными.')) e.preventDefault();
      }
      if (action === 'restore') {
        if (!confirm('Восстановить выбранных учеников (сделать активными)?')) e.preventDefault();
      }
    });
  }

  const oneForm = document.getElementById('one-action-form');
  const oneType = document.getElementById('one-action-type');
  const oneId = document.getElementById('one-action-id');

  document.querySelectorAll('.js-one-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = btn.dataset.studentId;
      if (!action || !id) return;

      if (action === 'delete') {
        if (!confirm('Удалить ученика? Он станет неактивным (история сохранится).')) return;
      } else if (action === 'restore') {
        if (!confirm('Восстановить ученика (сделать активным)?')) return;
      }

      oneType.value = action;
      oneId.value = id;
      oneForm.submit();
    });
  });

  updateSelectedCount();
  updateVisibleCount();
})();