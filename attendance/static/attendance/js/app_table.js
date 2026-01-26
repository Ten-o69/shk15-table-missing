(() => {
  const TABLE_CONTAINER_SEL = "[data-app-table]";
  const TABLE_SEL = "[data-app-table-target]";
  const COPY_BTN_SEL = "[data-table-copy]";
  const COPY_STATUS_SEL = "[data-copy-status]";

  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

  const SORT_TYPES = new Set(["text", "number", "class", "date"]);

  function normalizeWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeCellText(text) {
    return String(text || "")
      .replace(/\s*\n\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractControlValues(cell) {
    const controls = Array.from(cell.querySelectorAll("input, select, textarea"));
    const values = [];

    controls.forEach((ctrl) => {
      if (ctrl.hasAttribute("data-copy-ignore")) return;

      if (ctrl.tagName === "SELECT") {
        const selected = Array.from(ctrl.selectedOptions || [])
          .map((opt) => normalizeWhitespace(opt.textContent))
          .filter(Boolean);
        if (selected.length) values.push(selected.join(", "));
        return;
      }

      const type = (ctrl.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "hidden") return;

      const val = normalizeWhitespace(ctrl.value);
      if (val) values.push(val);
    });

    return values;
  }

  function getCellText(cell, { forSort = false } = {}) {
    if (!cell) return "";

    if (forSort && cell.dataset.sortValue) {
      return normalizeWhitespace(cell.dataset.sortValue);
    }

    if (!forSort && cell.dataset.copyValue) {
      return normalizeWhitespace(cell.dataset.copyValue);
    }

    const controlValues = extractControlValues(cell);
    if (controlValues.length) return controlValues.join(", ");

    const clone = cell.cloneNode(true);
    clone
      .querySelectorAll("[data-copy-ignore], button, .btn, form, svg, i, input, select, textarea")
      .forEach((el) => el.remove());

    const text = clone.innerText || clone.textContent || "";
    return normalizeCellText(text);
  }

  function parseNumber(value) {
    const raw = String(value || "").replace(/\s+/g, "").replace(",", ".");
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const num = parseFloat(match[0]);
    return Number.isFinite(num) ? num : null;
  }

  function parseRuDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const match = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const hour = match[4] ? parseInt(match[4], 10) : 0;
    const minute = match[5] ? parseInt(match[5], 10) : 0;

    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    return new Date(year, month - 1, day, hour, minute).getTime();
  }

  function compareValues(a, b, type) {
    if (type === "number") {
      const na = parseNumber(a);
      const nb = parseNumber(b);
      if (na === null && nb === null) return collator.compare(String(a), String(b));
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }

    if (type === "date") {
      const da = parseRuDate(a);
      const db = parseRuDate(b);
      if (da === null && db === null) return collator.compare(String(a), String(b));
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }

    if (type === "class" && window.ClassSort && typeof window.ClassSort.compareClassNames === "function") {
      return window.ClassSort.compareClassNames(a, b);
    }

    return collator.compare(String(a), String(b));
  }

  function isEmptyRow(row) {
    if (!row) return true;
    if (row.dataset.tableEmpty === "1") return true;
    if (row.cells.length === 1 && row.cells[0] && row.cells[0].hasAttribute("colspan")) return true;
    return false;
  }

  function sortTableByColumn(table, columnIndex, sortType, direction) {
    if (!table || !table.tBodies || !table.tBodies.length) return;

    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    if (rows.length < 2) return;

    const sortable = rows.filter((row) => !isEmptyRow(row));
    if (sortable.length < 2) return;

    const otherRows = rows.filter((row) => !sortable.includes(row));

    const withIndex = sortable.map((row, idx) => {
      const cell = row.cells[columnIndex];
      return {
        row,
        idx,
        value: getCellText(cell, { forSort: true }),
      };
    });

    withIndex.sort((a, b) => {
      const cmp = compareValues(a.value, b.value, sortType);
      if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      return a.idx - b.idx;
    });

    withIndex.forEach((item) => tbody.appendChild(item.row));
    otherRows.forEach((row) => tbody.appendChild(row));
  }

  function setSortState(th, direction) {
    const headerRow = th.closest("thead");
    if (!headerRow) return;

    const all = headerRow.querySelectorAll("th[data-sort]");
    all.forEach((cell) => {
      if (cell === th) return;
      cell.removeAttribute("data-sort-dir");
      cell.removeAttribute("aria-sort");
    });

    if (direction) {
      th.setAttribute("data-sort-dir", direction);
      th.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
    } else {
      th.removeAttribute("data-sort-dir");
      th.removeAttribute("aria-sort");
    }
  }

  function handleSortClick(th, index) {
    const sortType = SORT_TYPES.has(th.dataset.sort) ? th.dataset.sort : "text";
    const current = th.getAttribute("data-sort-dir");
    const next = current === "asc" ? "desc" : "asc";

    const table = th.closest("table");
    if (!table) return;

    sortTableByColumn(table, index, sortType, next);
    setSortState(th, next);
  }

  function applySortColumns(table) {
    const raw = (table.dataset.sortColumns || "").trim();
    if (!raw) return;

    const types = raw.split(",").map((item) => item.trim());
    if (!types.length) return;

    const headers = Array.from(table.querySelectorAll("thead th"));
    types.forEach((type, idx) => {
      if (!headers[idx]) return;
      const normalized = String(type || "").toLowerCase();
      if (!normalized || normalized === "none" || normalized === "-") return;
      if (!headers[idx].dataset.sort) headers[idx].dataset.sort = normalized;
    });
  }

  function initSorting(table) {
    applySortColumns(table);
    const headers = Array.from(table.querySelectorAll("thead th[data-sort]"));
    if (!headers.length) return;

    headers.forEach((th, index) => {
      th.setAttribute("role", "button");
      if (!th.hasAttribute("tabindex")) th.setAttribute("tabindex", "0");

      th.addEventListener("click", () => handleSortClick(th, index));
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSortClick(th, index);
        }
      });
    });
  }

  function isRowVisible(row) {
    if (!row) return false;
    if (row.hidden) return false;
    if (row.style.display === "none") return false;
    return true;
  }

  function buildRowsFromSection(section, { includeHidden }) {
    const out = [];
    if (!section) return out;

    Array.from(section.rows).forEach((row) => {
      if (!includeHidden && !isRowVisible(row)) return;
      const cells = Array.from(row.cells || []);
      if (!cells.length) return;
      out.push(cells);
    });

    return out;
  }

  function buildTableText(table, { includeHidden = true } = {}) {
    if (!table) return "";

    const rows = [];
    rows.push(...buildRowsFromSection(table.tHead, { includeHidden }));
    Array.from(table.tBodies || []).forEach((body) => {
      rows.push(...buildRowsFromSection(body, { includeHidden }));
    });
    rows.push(...buildRowsFromSection(table.tFoot, { includeHidden }));

    return rows
      .map((cells) => cells.map((cell) => getCellText(cell)).join("\t"))
      .join("\n")
      .trim();
  }

  function collectSelectedCells(table, range) {
    if (!range) return [];
    const sections = [table.tHead, ...Array.from(table.tBodies || []), table.tFoot].filter(Boolean);
    const selectedRows = [];

    sections.forEach((section) => {
      Array.from(section.rows).forEach((row) => {
        const cells = Array.from(row.cells).filter((cell) => {
          try {
            return range.intersectsNode(cell);
          } catch {
            return false;
          }
        });
        if (cells.length) selectedRows.push(cells);
      });
    });

    return selectedRows;
  }

  async function writeClipboard(text) {
    if (!text) return false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fallback below
      }
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function setCopyStatus(container, button, message, ok = true) {
    const statusEl = container ? container.querySelector(COPY_STATUS_SEL) : null;
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.toggle("text-success", ok);
      statusEl.classList.toggle("text-danger", !ok);
      return;
    }

    if (!button) return;
    const prev = button.dataset.copyLabel || button.textContent;
    button.dataset.copyLabel = prev;
    button.textContent = message;
    button.classList.toggle("btn-outline-light", ok);
    button.classList.toggle("btn-outline-danger", !ok);

    setTimeout(() => {
      button.textContent = button.dataset.copyLabel || prev;
      button.classList.toggle("btn-outline-danger", false);
      button.classList.toggle("btn-outline-light", true);
    }, 1600);
  }

  async function handleCopyButtonClick(btn) {
    const container = btn.closest(TABLE_CONTAINER_SEL);
    const table = container ? container.querySelector(TABLE_SEL) : btn.closest("table");
    if (!table) return;

    const includeHidden = !(container && container.dataset.copyVisible === "true");
    const text = buildTableText(table, { includeHidden });
    const ok = await writeClipboard(text);

    if (ok) {
      setCopyStatus(container, btn, "Скопировано", true);
    } else {
      setCopyStatus(container, btn, "Не удалось скопировать", false);
    }
  }

  function initCopyButtons(root = document) {
    root.querySelectorAll(COPY_BTN_SEL).forEach((btn) => {
      if (btn.dataset.copyBound === "1") return;
      btn.dataset.copyBound = "1";
      btn.addEventListener("click", () => handleCopyButtonClick(btn));
    });
  }

  function handleSelectionCopy(e) {
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return;

    const table = element.closest(TABLE_SEL);
    if (!table) return;

    const selectedRows = collectSelectedCells(table, range);
    if (!selectedRows.length) return;

    const text = selectedRows
      .map((cells) => cells.map((cell) => getCellText(cell)).join("\t"))
      .join("\n")
      .trim();

    if (!text) return;

    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  }

  function initTables(root = document) {
    root.querySelectorAll(TABLE_SEL).forEach((table) => initSorting(table));
    initCopyButtons(root);
  }

  function init() {
    initTables();
    document.addEventListener("copy", handleSelectionCopy);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
