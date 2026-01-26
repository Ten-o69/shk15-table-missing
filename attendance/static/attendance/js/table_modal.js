(() => {
  const modalEl = document.getElementById("table-modal");
  if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) return;

  const dialogEl = modalEl.querySelector(".modal-dialog");
  const titleEl = document.getElementById("table-modal-title");
  const subtitleEl = document.getElementById("table-modal-subtitle");
  const searchWrap = document.getElementById("table-modal-search-wrap");
  const searchInput = document.getElementById("table-modal-search");
  const sortWrap = document.getElementById("table-modal-sort-wrap");
  const sortSelect = document.getElementById("table-modal-sort");
  const listEl = document.getElementById("table-modal-list");
  const hintEl = document.getElementById("table-modal-hint");
  const emptyEl = document.getElementById("table-modal-empty");
  const applyBtn = document.getElementById("table-modal-apply");
  const cancelBtn = document.getElementById("table-modal-cancel");
  const secondaryBtn = document.getElementById("table-modal-secondary");

  if (!dialogEl || !titleEl || !searchInput || !sortSelect || !listEl || !applyBtn || !cancelBtn) {
    console.warn("Table modal: required elements not found.");
    return;
  }

  const SIZE_CLASSES = ["modal-sm", "modal-lg", "modal-xl"];
  const DEFAULT_SORTS = [
    { value: "default", label: "По порядку" },
    { value: "name_asc", label: "ФИО А-Я" },
    { value: "name_desc", label: "ФИО Я-А" },
  ];

  const bsModal = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
    backdrop: false,
    keyboard: true,
    focus: true,
  });

  let state = {};

  function compareRu(a, b) {
    return a.localeCompare(b, "ru", { sensitivity: "base" });
  }

  function getCompare() {
    if (state.sortCompare) return state.sortCompare;
    if (
      state.sortMode === "class" &&
      window.ClassSort &&
      typeof window.ClassSort.compareClassNames === "function"
    ) {
      return window.ClassSort.compareClassNames;
    }
    return compareRu;
  }

  function normalizeItems(items) {
    return (items || []).map((item, idx) => {
      const label = String(item.label || "").trim();
      const id = item.id != null ? String(item.id) : String(idx);
      return {
        id,
        label,
        labelLower: label.toLowerCase(),
        disabled: !!item.disabled,
        __index: idx,
      };
    });
  }

  function setDialogSize(size) {
    if (!dialogEl) return;
    SIZE_CLASSES.forEach((cls) => dialogEl.classList.remove(cls));
    dialogEl.classList.remove("app-modal-sheet-lg");

    if (size === "sm") dialogEl.classList.add("modal-sm");
    else if (size === "lg") dialogEl.classList.add("modal-lg");
    else if (size === "xl") dialogEl.classList.add("modal-xl");

    if (size === "lg" || size === "xl") {
      dialogEl.classList.add("app-modal-sheet-lg");
    }
  }

  function setSortOptions(options, defaultValue) {
    const opts = (options && options.length) ? options : DEFAULT_SORTS;
    sortSelect.innerHTML = "";
    opts.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      sortSelect.appendChild(o);
    });

    const value = defaultValue && opts.some((o) => o.value === defaultValue)
      ? defaultValue
      : opts[0].value;
    sortSelect.value = value;
  }

  function getSorted(items, sortValue) {
    const list = [...items];
    const compare = getCompare();
    if (sortValue === "name_asc") {
      list.sort((a, b) => compare(a.label, b.label));
    } else if (sortValue === "name_desc") {
      list.sort((a, b) => compare(b.label, a.label));
    } else {
      list.sort((a, b) => a.__index - b.__index);
    }
    return list;
  }

  function renderList() {
    const term = (searchInput.value || "").trim().toLowerCase();
    const sortValue = sortSelect.value || state.defaultSort;

    let items = state.items;
    if (term) {
      items = items.filter((i) => i.labelLower.includes(term));
    }

    const view = getSorted(items, sortValue);
    listEl.innerHTML = "";

    if (emptyEl) {
      emptyEl.classList.toggle("d-none", view.length > 0);
      if (view.length === 0) emptyEl.textContent = state.emptyText || "Нет данных.";
    }

    view.forEach((item) => {
      if (!state.selectable) {
        const row = document.createElement("div");
        row.className = "table-modal-item table-modal-item--readonly";
        row.textContent = item.label || "—";
        listEl.appendChild(row);
        return;
      }

      const row = document.createElement("label");
      row.className = "table-modal-item";
      if (item.disabled) row.classList.add("table-modal-item--disabled");
      row.dataset.name = item.labelLower;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.id;
      checkbox.checked = state.selected.has(item.id);
      checkbox.disabled = item.disabled;

      const span = document.createElement("span");
      span.textContent = item.label || "—";

      row.appendChild(checkbox);
      row.appendChild(span);
      listEl.appendChild(row);
    });

    if (typeof state.subtitleBuilder === "function") {
      const text = state.subtitleBuilder({ shown: view.length, total: state.items.length }) || "";
      if (subtitleEl) subtitleEl.textContent = text;
    }
  }

  listEl.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const id = String(cb.value);
    if (cb.checked) state.selected.add(id);
    else state.selected.delete(id);
  });

  searchInput.addEventListener("input", renderList);
  sortSelect.addEventListener("change", renderList);

  applyBtn.addEventListener("click", () => {
    if (!state.onApply) {
      bsModal.hide();
      return;
    }
    const result = state.onApply(Array.from(state.selected));
    if (result !== false) bsModal.hide();
  });

  if (secondaryBtn) {
    secondaryBtn.addEventListener("click", () => {
      if (!state.onSecondary) {
        bsModal.hide();
        return;
      }
      const result = state.onSecondary(Array.from(state.selected));
      if (result !== false) bsModal.hide();
    });
  }

  modalEl.addEventListener("hidden.bs.modal", () => {
    if (state.onClose) state.onClose();
    searchInput.value = "";
    listEl.innerHTML = "";
    if (hintEl) hintEl.classList.add("d-none");
    if (emptyEl) emptyEl.classList.add("d-none");
    state = {};
  });

  function open(config) {
    const cfg = config || {};
    const selectable = cfg.selectable !== false;
    const selectedIds = new Set((cfg.selectedIds || []).map(String));

    state = {
      title: cfg.title || "",
      subtitle: cfg.subtitle || "",
      subtitleBuilder: cfg.subtitleBuilder || null,
      items: normalizeItems(cfg.items || []),
      selectable,
      selected: selectedIds,
      onApply: cfg.onApply || null,
      onSecondary: cfg.onSecondary || null,
      onClose: cfg.onClose || null,
      sortMode: cfg.sortMode || "label",
      sortCompare: typeof cfg.sortCompare === "function" ? cfg.sortCompare : null,
      defaultSort: cfg.defaultSort || "default",
      emptyText: cfg.emptyText || "Нет данных.",
    };

    titleEl.textContent = state.title;
    if (subtitleEl) subtitleEl.textContent = state.subtitle || "";
    searchInput.placeholder = cfg.searchPlaceholder || "Поиск...";

    if (searchWrap) {
      searchWrap.classList.toggle("d-none", cfg.allowSearch === false);
    }
    if (sortWrap) {
      sortWrap.classList.toggle("d-none", cfg.allowSort === false);
    }

    setSortOptions(cfg.sortOptions, state.defaultSort);
    setDialogSize(cfg.size || "lg");

    if (hintEl) {
      const hintText = cfg.hintText || "";
      hintEl.textContent = hintText;
      hintEl.classList.toggle("d-none", !hintText);
    }

    if (secondaryBtn) {
      const showSecondary = !!cfg.secondaryLabel;
      secondaryBtn.textContent = cfg.secondaryLabel || "";
      secondaryBtn.classList.toggle("d-none", !showSecondary);
    }

    const showApply = cfg.showApply !== false && selectable;
    applyBtn.textContent = cfg.applyLabel || "Применить";
    applyBtn.classList.toggle("d-none", !showApply);

    cancelBtn.textContent = cfg.cancelLabel || "Отмена";

    renderList();
    bsModal.show();
    setTimeout(() => searchInput.focus(), 50);
  }

  window.TableModal = { open };
})();
