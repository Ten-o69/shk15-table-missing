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
  // Unified table modal: privilege types
  // ---------------------------------
  const tableModal = window.TableModal;
  const form = $("#priv-type-form");
  const formStudentId = $("#priv-type-student-id");
  const formValue = $("#priv-type-value");

  const sortOptions = [
    { value: "default", label: "По порядку" },
    { value: "name_asc", label: "Название А-Я" },
    { value: "name_desc", label: "Название Я-А" },
  ];

  const privTypes = [
    { id: "svo", label: "СВО" },
    { id: "multi", label: "Многодетные" },
    { id: "low_income", label: "Малоимущие" },
    { id: "disabled", label: "ОВЗ" },
  ];

  let currentStudentId = null;

  function openModal(studentId, studentName, currentTypes) {
    if (!tableModal) return;

    currentStudentId = String(studentId || "");
    if (!currentStudentId) return;

    const selected = (currentTypes || "")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    const items = privTypes.map(t => ({ id: t.id, label: t.label }));

    tableModal.open({
      title: "Типы льгот",
      subtitle: studentName ? `Ученик: ${studentName}` : "",
      items,
      selectable: true,
      selectedIds: selected,
      searchPlaceholder: "Поиск по типам...",
      sortOptions,
      defaultSort: "default",
      applyLabel: "Сохранить",
      cancelLabel: "Отмена",
      secondaryLabel: "Снять льготу",
      size: "md",
      onApply: (selectedIds) => {
        if (!form || !formStudentId || !formValue) return true;
        if (!currentStudentId) return true;

        if (!selectedIds.length) {
          alert("Выберите один или несколько типов льготы или нажмите «Снять льготу».");
          return false;
        }

        formStudentId.value = currentStudentId;
        formValue.value = selectedIds.join(",");
        form.submit();
        return true;
      },
      onSecondary: () => {
        if (!form || !formStudentId || !formValue) return true;
        if (!currentStudentId) return true;

        formStudentId.value = currentStudentId;
        formValue.value = "";
        form.submit();
        return true;
      },
      onClose: () => {
        currentStudentId = null;
      },
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-open-priv-type");
    if (!btn) return;

    const sid = btn.dataset.studentId;
    const name = btn.dataset.studentName || "";
    const cur = btn.dataset.currentTypes || "";

    openModal(sid, name, cur);
  });

  // initial counters
  updateVisibleCount();
  updateSelectedCount();
})();
