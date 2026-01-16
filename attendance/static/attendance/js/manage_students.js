(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------
  // Bulk select counters + visible rows
  // ---------------------------------
  const tableWrap = $("#students-grid");
  if (!tableWrap) return;

  const rows = () => $$("tbody tr.student-row", tableWrap);

  const visibleRows = () =>
    rows().filter(r => r.style.display !== "none");

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

  // check all / uncheck all (только видимые)
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

  // live update selection
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
  // One-action delete/restore
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
  // Privilege type modal
  // ---------------------------------
  const modal = $("#priv-type-modal");
  const subtitle = $("#priv-type-subtitle");
  const applyBtn = $("#priv-type-apply");
  const cancelBtn = $("#priv-type-cancel");
  const clearBtn = $("#priv-type-clear");

  const form = $("#priv-type-form");
  const formStudentId = $("#priv-type-student-id");
  const formValue = $("#priv-type-value");

  let currentStudentId = null;

  const openModal = (studentId, studentName, currentType) => {
    currentStudentId = String(studentId || "");
    if (!currentStudentId) return;

    if (subtitle) {
      subtitle.textContent = studentName ? `Ученик: ${studentName}` : "";
    }

    // reset + set current
    $$('input[name="priv_type"]', modal).forEach(r => (r.checked = false));
    if (currentType) {
      const radio = $(`input[name="priv_type"][value="${currentType}"]`, modal);
      if (radio) radio.checked = true;
    }

    modal.classList.remove("hidden");
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.add("hidden");
    currentStudentId = null;
  };

  // open buttons
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-open-priv-type");
    if (!btn) return;

    const sid = btn.dataset.studentId;
    const name = btn.dataset.studentName || "";
    const cur = btn.dataset.currentType || "";

    openModal(sid, name, cur);
  });

  // apply
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!form || !formStudentId || !formValue) return;
      if (!currentStudentId) return;

      const selected = $('input[name="priv_type"]:checked', modal);
      if (!selected) {
        alert("Выберите тип льготы или нажмите «Снять льготу».");
        return;
      }

      formStudentId.value = currentStudentId;
      formValue.value = selected.value;
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

  // cancel / overlay / escape
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  // initial counters
  updateVisibleCount();
  updateSelectedCount();
})();