(() => {
  // --- modal elements ---
  const modal = document.getElementById('ttl-modal');
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
    mPreview.textContent = human(sec,min,hour,day,week);
  }

  [mSec,mMin,mHour,mDay,mWeek].forEach(inp => inp.addEventListener('input', updatePreview));

  function open(){
    // подхватываем текущие hidden значения
    mSec.value  = hSec.value  || 0;
    mMin.value  = hMin.value  || 0;
    mHour.value = hHour.value || 0;
    mDay.value  = hDay.value  || 0;
    mWeek.value = hWeek.value || 0;
    updatePreview();
    modal.classList.remove('hidden');
  }
  function close(){
    modal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', open);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !modal.classList.contains('hidden')) close(); });

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const sec = n(mSec.value), min=n(mMin.value), hour=n(mHour.value), day=n(mDay.value), week=n(mWeek.value);
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
      hSec.value = sec; hMin.value=min; hHour.value=hour; hDay.value=day; hWeek.value=week;

      // красивый preview на форме
      if (ttlPreview) ttlPreview.textContent = human(sec,min,hour,day,week);

      close();
    });
  }

  // init preview at page load
  if (ttlPreview) {
    const sec = n(hSec.value), min=n(hMin.value), hour=n(hHour.value), day=n(hDay.value), week=n(hWeek.value);
    ttlPreview.textContent = human(sec,min,hour,day,week);
  }

  // ===== copy token button =====
  const copyBtn = document.getElementById('copy-token-btn');
  const tokenText = document.getElementById('token-text');
  const status = document.getElementById('copy-status');

  if (copyBtn && tokenText) {
    copyBtn.addEventListener('click', async () => {
      const txt = (tokenText.textContent || '').trim();
      if (!txt) return;

      try {
        await navigator.clipboard.writeText(txt);
        if (status) {
          status.style.display = 'block';
          status.textContent = 'Скопировано в буфер обмена ✅';
        }
      } catch (e) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);

        if (status) {
          status.style.display = 'block';
          status.textContent = 'Скопировано ✅';
        }
      }
    });
  }

})();