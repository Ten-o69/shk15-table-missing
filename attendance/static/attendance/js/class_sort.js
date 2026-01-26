(() => {
  const CLASS_RE = /^\s*(\d+)\s*(.*)$/;
  const collator = new Intl.Collator("ru", { sensitivity: "base" });

  function classSortKey(value) {
    const raw = value == null ? "" : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return { num: Number.POSITIVE_INFINITY, suffix: "" };

    const match = trimmed.match(CLASS_RE);
    if (!match) {
      return { num: Number.POSITIVE_INFINITY, suffix: trimmed.toLowerCase() };
    }

    const num = parseInt(match[1], 10);
    const suffix = (match[2] || "").trim().toLowerCase();
    return { num: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY, suffix };
  }

  function compareClassNames(a, b) {
    const ka = classSortKey(a);
    const kb = classSortKey(b);
    if (ka.num !== kb.num) return ka.num - kb.num;
    if (ka.suffix === kb.suffix) return 0;
    return collator.compare(ka.suffix, kb.suffix);
  }

  function sortByClassName(list, accessor) {
    const getValue = typeof accessor === "function" ? accessor : (item) => item;
    return [...list].sort((a, b) => compareClassNames(getValue(a), getValue(b)));
  }

  window.ClassSort = {
    classSortKey,
    compareClassNames,
    sortByClassName,
  };
})();
