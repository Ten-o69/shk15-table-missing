(() => {
  const modalEl = document.getElementById('ttl-modal');
  const openBtn = document.getElementById('open-ttl-modal');
  const cancelBtn = document.getElementById('ttl-cancel');
  const applyBtn = document.getElementById('ttl-apply');

  // inputs inside modal
  const mSec  = document.getElementById('m_sec');
  const mMin  = document.getElementById('m_min');
  const mHour = document.getElementById('m_hour');
  const mDay  = document.getElementById('m_day');
  const mWeek = document.getElementById('m_week');
  const mPreview = document.getElementById('m_preview');

  // hidden form fields
  const hSec  = document.getElementById('ttl_sec');
  const hMin  = document.getElementById('ttl_min');
  const hHour = document.getElementById('ttl_hour');
  const hDay  = document.getElementById('ttl_day');
  const hWeek = document.getElementById('ttl_week');

  const ttlPreview = document.getElementById('ttl-preview');

  function n(v){ v = parseInt(v,10); return Number.isFinite(v) && v>0 ? v : 0; }

  function totalSeconds(sec, min, hour, day, week){
    return sec + min*60 + hour*3600 + day*86400 + week*604800;
  }

  function human(sec, min, hour, day, week){
    const parts = [];
    if (week) parts.push(`${week} нед`);
    if (day) parts.push(`${day} д`);
    if (hour) parts.push(`${hour} ч`);
    if (min) parts.push(`${min} мин`);
    if (sec) parts.push(`${sec} сек`);
    if (!parts.length) return '0 сек';
    return parts.join(' ');
  }

  function updatePreview(){
    const sec = n(mSec.value), min=n(mMin.value), hour=n(mHour.value), day=n(mDay.value), week=n(mWeek.value);
    if (mPreview) mPreview.textContent = human(sec,min,hour,day,week);
  }

  [mSec,mMin,mHour,mDay,mWeek].forEach(inp => inp && inp.addEventListener('input', updatePreview));

  // Bootstrap modal instance (if Bootstrap loaded)
  let bsModal = null;
  if (modalEl && window.bootstrap && typeof window.bootstrap.Modal === 'function') {
    bsModal = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
      backdrop: true,
      keyboard: true,
      focus: true
    });
  }

  function open(){
    // подхватываем текущие hidden значения
    if (mSec)  mSec.value  = hSec.value  || 0;
    if (mMin)  mMin.value  = hMin.value  || 0;
    if (mHour) mHour.value = hHour.value || 0;
    if (mDay)  mDay.value  = hDay.value  || 0;
    if (mWeek) mWeek.value = hWeek.value || 0;

    updatePreview();

    if (bsModal) {
      bsModal.show();
    } else if (modalEl) {
      // fallback: если вдруг bootstrap modal не подключен
      modalEl.classList.add('show');
      modalEl.style.display = 'block';
      modalEl.removeAttribute('aria-hidden');
      document.body.classList.add('modal-open');
    }

    // фокус в первое поле для скорости
    setTimeout(() => { if (mMin) mMin.focus(); }, 50);
  }

  function close(){
    if (bsModal) {
      bsModal.hide();
    } else if (modalEl) {
      modalEl.classList.remove('show');
      modalEl.style.display = 'none';
      modalEl.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
    }
  }

  if (openBtn) openBtn.addEventListener('click', open);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const sec = n(mSec && mSec.value), min=n(mMin && mMin.value), hour=n(mHour && mHour.value), day=n(mDay && mDay.value), week=n(mWeek && mWeek.value);
      const ttl = totalSeconds(sec,min,hour,day,week);

      if (ttl < 30) {
        alert('Минимальная длительность — 30 секунд.');
        return;
      }
      if (ttl > 14*24*3600) {
        alert('Максимальная длительность — 2 недели.');
        return;
      }

      // записали hidden поля
      if (hSec)  hSec.value  = sec;
      if (hMin)  hMin.value  = min;
      if (hHour) hHour.value = hour;
      if (hDay)  hDay.value  = day;
      if (hWeek) hWeek.value = week;

      // красивый preview на форме
      if (ttlPreview) ttlPreview.textContent = human(sec,min,hour,day,week);

      close();
    });
  }

  // init preview at page load
  if (ttlPreview && hSec && hMin && hHour && hDay && hWeek) {
    const sec = n(hSec.value), min=n(hMin.value), hour=n(hHour.value), day=n(hDay.value), week=n(hWeek.value);
    ttlPreview.textContent = human(sec,min,hour,day,week);
  }

  // ===== copy token button =====
  const copyBtn = document.getElementById('copy-token-btn');
  const tokenText = document.getElementById('token-text');
  const status = document.getElementById('copy-status');

  function setStatus(msg, ok = true) {
    if (!status) return;
    status.classList.remove('d-none');
    status.textContent = msg;
    status.style.display = ''; // for compatibility with previous inline style usage
    status.classList.toggle('text-success', ok);
    status.classList.toggle('text-danger', !ok);
  }

  if (copyBtn && tokenText) {
    copyBtn.addEventListener('click', async () => {
      const txt = (tokenText.textContent || '').trim();
      if (!txt) return;

      try {
        await navigator.clipboard.writeText(txt);
        setStatus('Скопировано в буфер обмена ✅', true);
      } catch (e) {
        // fallback
        try {
          const ta = document.createElement('textarea');
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          setStatus('Скопировано ✅', true);
        } catch (e2) {
          setStatus('Не удалось скопировать. Скопируйте вручную.', false);
        }
      }
    });
  }
})();