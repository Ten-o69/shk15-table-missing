(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const tableWrap = $("#students-grid");
  if (!tableWrap) return;

  const rows = () => $$("tbody tr.student-row", tableWrap);
  const visibleRows = () => rows().filter(r => r.style.display !== "none");

  const updateVisibleCount = () => {
    const el = $("#visible-count");
    if (!el) return;
    el.textContent = String(visibleRows().length);
  };

  const updateSelectedCount = () => {
    const el = $("#selected-count");
    if (!el) return;
    const checked = $$('input.student-check:checked', tableWrap).length;
    el.textContent = String(checked);
  };

  // ---------------------------------
  // check all / uncheck all (только видимые)
  // ---------------------------------
  const checkAllBtn = $("#check-all");
  const uncheckAllBtn = $("#uncheck-all");

  if (checkAllBtn) {
    checkAllBtn.addEventListener("click", () => {
      visibleRows().forEach(r => {
        const cb = $('input.student-check', r);
        if (cb) cb.checked = true;
      });
      updateSelectedCount();
    });
  }

  if (uncheckAllBtn) {
    uncheckAllBtn.addEventListener("click", () => {
      visibleRows().forEach(r => {
        const cb = $('input.student-check', r);
        if (cb) cb.checked = false;
      });
      updateSelectedCount();
    });
  }

  tableWrap.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("student-check")) {
      updateSelectedCount();
    }
  });

  // ---------------------------------
  // Client-side quick filter (без перезагрузки)
  // ---------------------------------
  const clientSearch = $("#client-search");
  if (clientSearch) {
    clientSearch.addEventListener("input", () => {
      const term = (clientSearch.value || "").trim().toLowerCase();

      rows().forEach(r => {
        const name = (r.dataset.name || "").toLowerCase();
        const cls = (r.dataset.class || "").toLowerCase();
        const ptype = (r.dataset.privType || "").toLowerCase();

        const ok = !term || name.includes(term) || cls.includes(term) || ptype.includes(term);
        r.style.display = ok ? "" : "none";
      });

      updateVisibleCount();
    });
  }

  // ---------------------------------
  // One-action delete/restore (как было)
  // ---------------------------------
  const oneForm = $("#one-action-form");
  const oneType = $("#one-action-type");
  const oneId = $("#one-action-id");

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-one-action");
    if (!btn) return;
    if (!oneForm || !oneType || !oneId) return;

    const action = btn.dataset.action;
    const sid = btn.dataset.studentId;

    if (!action || !sid) return;

    oneType.value = action;
    oneId.value = sid;
    oneForm.submit();
  });

  // ---------------------------------
  // Privilege type modal (Bootstrap)
  // ---------------------------------
  const modalEl = $("#priv-type-modal");
  const subtitle = $("#priv-type-subtitle");
  const applyBtn = $("#priv-type-apply");
  const clearBtn = $("#priv-type-clear");

  const form = $("#priv-type-form");
  const formStudentId = $("#priv-type-student-id");
  const formValue = $("#priv-type-value");

  let currentStudentId = null;

  const hasBootstrap = () =>
    typeof window !== "undefined" && window.bootstrap && window.bootstrap.Modal;

  if (!modalEl || !hasBootstrap()) {
    // Если вдруг Bootstrap JS не подхватился — просто не ломаем страницу.
    updateVisibleCount();
    updateSelectedCount();
    return;
  }

  const BS = window.bootstrap;
  const getModalInstance = () =>
    BS.Modal.getInstance(modalEl) || new BS.Modal(modalEl, {
      backdrop: false,
      keyboard: true,
      focus: true
    });

  const bsModal = getModalInstance();

  const openModal = (studentId, studentName, currentTypes) => {
    currentStudentId = String(studentId || "");
    if (!currentStudentId) return;

    if (subtitle) {
      subtitle.textContent = studentName ? `Ученик: ${studentName}` : "";
    }

    // reset + set current
    $$('input[name="priv_type"]', modalEl).forEach(r => (r.checked = false));
    const typeList = (currentTypes || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);
    if (typeList.length) {
      typeList.forEach((t) => {
        const box = $(`input[name="priv_type"][value="${t}"]`, modalEl);
        if (box) box.checked = true;
      });
    }

    bsModal.show();
  };

  // open buttons
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-open-priv-type");
    if (!btn) return;

    const sid = btn.dataset.studentId;
    const name = btn.dataset.studentName || "";
    const cur = btn.dataset.currentTypes || "";

    openModal(sid, name, cur);
  });

  // apply
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!form || !formStudentId || !formValue) return;
      if (!currentStudentId) return;

      const selected = $$('input[name="priv_type"]:checked', modalEl);
      if (!selected.length) {
        alert("Выберите один или несколько типов льготы или нажмите «Снять льготу».");
        return;
      }

      formStudentId.value = currentStudentId;
      formValue.value = selected.map(el => el.value).join(",");
      form.submit();
    });
  }

  // clear
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!form || !formStudentId || !formValue) return;
      if (!currentStudentId) return;

      formStudentId.value = currentStudentId;
      formValue.value = "";
      form.submit();
    });
  }

  // reset state on close
  modalEl.addEventListener("hidden.bs.modal", () => {
    currentStudentId = null;
    if (subtitle) subtitle.textContent = "";
    $$('input[name="priv_type"]', modalEl).forEach(r => (r.checked = false));
  });

  // initial counters
  updateVisibleCount();
  updateSelectedCount();
})();
