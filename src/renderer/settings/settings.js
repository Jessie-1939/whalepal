/* 设置窗口：配置读写、立即理解、云端模型测试、上下文对话、数据管理。 */
(function () {
  const api = window.whalePal;
  const $ = (s) => document.querySelector(s);

  // 供应商预设由主进程统一提供（config:presets），避免两处定义漂移
  let presets = {};

  let cfg = null;
  let toastTimer = null;
  const cal = {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    selected: null
  };

  function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
    return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  async function save(patch) {
    cfg = await api.invoke('config:set', patch);
    toast('已保存');
  }

  function switchTab(tab) {
    for (const b of document.querySelectorAll('#tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    for (const sec of document.querySelectorAll('main section')) {
      sec.hidden = sec.id !== `tab-${tab}`;
    }
    if (tab === 'data') refreshStats();
    if (tab === 'context') refreshNow();
    if (tab === 'calendar') refreshCalendar();
  }

  function bindTabs() {
    for (const btn of document.querySelectorAll('#tabs button')) {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    }
  }

  // ---------- 日历 ----------
  async function refreshCalendar() {
    try {
      const data = await api.invoke('context:calendar', { year: cal.year, month: cal.month });
      $('#cal-label').textContent = `${data.year} 年 ${data.month} 月`;
      const t = data.totals || {};
      $('#cal-totals').textContent = `本月专注约 ${Math.round((t.workingMs || 0) / 60000)} 分钟 · 有记录 ${t.activeDays || 0} 天 · 片段 ${t.count || 0} 条`;
      const grid = $('#cal-grid');
      grid.innerHTML = '';
      const first = new Date(cal.year, cal.month - 1, 1);
      const lead = (first.getDay() + 6) % 7; // 周一开头
      for (let i = 0; i < lead; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-cell empty';
        grid.appendChild(blank);
      }
      const daysInMonth = new Date(cal.year, cal.month, 0).getDate();
      const todayKey = localDateKey();
      for (let day = 1; day <= daysInMonth; day++) {
        const key = `${cal.year}-${String(cal.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const info = (data.days && data.days[key]) || { count: 0, workingMs: 0, level: 0, topApp: '' };
        const cell = document.createElement('div');
        cell.className = `cal-cell lvl${info.level}${key === todayKey ? ' today' : ''}${key === cal.selected ? ' selected' : ''}`;
        const d = document.createElement('span');
        d.className = 'd';
        d.textContent = String(day);
        const m = document.createElement('span');
        m.className = 'm';
        m.textContent = info.count ? (info.workingMs > 0 ? `${Math.round(info.workingMs / 60000)}m` : `${info.count}条`) : '';
        cell.appendChild(d);
        cell.appendChild(m);
        cell.title = info.count
          ? `${info.count} 个片段 · 专注约 ${Math.round(info.workingMs / 60000)} 分钟${info.topApp ? ' · 主力：' + info.topApp : ''}`
          : '无记录';
        cell.addEventListener('click', () => selectDay(key));
        grid.appendChild(cell);
      }
    } catch {
      // 忽略
    }
  }

  async function selectDay(key) {
    cal.selected = key;
    const agg = await api.invoke('context:day', key);
    $('#cal-day-title').textContent = `${key} 的活动`;
    $('#cal-day-stats').textContent = agg.count
      ? `${agg.count} 个片段 · ${agg.firstTime} ~ ${agg.lastTime} · 专注约 ${Math.round(agg.workingMs / 60000)} 分钟`
      : '这一天没有记录。';
    const tl = $('#cal-timeline');
    tl.innerHTML = '';
    for (const e of agg.events.slice().reverse()) {
      const div = document.createElement('div');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = e.time || '';
      div.appendChild(t);
      const minutes = Number(e.durationMs) > 0 ? ` · ${Math.round(Number(e.durationMs) / 60000)}m` : '';
      div.appendChild(document.createTextNode(`${e.activity || ''} · ${e.app || ''}${e.isWorking ? ' · 工作' : ''}${minutes}`));
      tl.appendChild(div);
    }
    $('#cal-summary-btn').disabled = !agg.count;
    $('#cal-summary-wrap').hidden = true;
    $('#cal-summary').textContent = '';
    $('#cal-summary-status').textContent = '';
    refreshCalendar();
  }

  function bindCalendar() {
    $('#cal-prev').addEventListener('click', () => {
      cal.month -= 1;
      if (cal.month < 1) {
        cal.month = 12;
        cal.year -= 1;
      }
      refreshCalendar();
    });
    $('#cal-next').addEventListener('click', () => {
      cal.month += 1;
      if (cal.month > 12) {
        cal.month = 1;
        cal.year += 1;
      }
      refreshCalendar();
    });
    $('#cal-summary-btn').addEventListener('click', async () => {
      if (!cal.selected) return;
      const status = $('#cal-summary-status');
      status.textContent = '正在整理…';
      const r = await api.invoke('context:day-summary', cal.selected);
      const box = $('#cal-summary');
      $('#cal-summary-wrap').hidden = false;
      box.textContent = r.text;
      status.textContent = r.source === 'cloud' ? '（云端模型）' : '（本地记录整理）';
    });
  }

  function bindCompanion() {
    $('#c-name').value = cfg.companion.name;
    $('#c-self').value = cfg.companion.selfName;
    $('#c-visible').checked = cfg.companion.visible;
    $('#c-walk').checked = cfg.companion.walk;
    $('#c-bubbles').checked = cfg.companion.bubbles;
    $('#c-care').checked = cfg.companion.care;
    $('#c-proactive').checked = cfg.companion.proactive !== false;
    $('#c-quiet-start').value = cfg.companion.quietHours.start;
    $('#c-quiet-end').value = cfg.companion.quietHours.end;

    $('#c-name').addEventListener('change', (e) => save({ companion: { name: e.target.value || '主人' } }));
    $('#c-self').addEventListener('change', (e) => save({ companion: { selfName: e.target.value || '小鲸' } }));
    $('#c-visible').addEventListener('change', (e) => save({ companion: { visible: e.target.checked } }));
    $('#c-walk').addEventListener('change', (e) => save({ companion: { walk: e.target.checked } }));
    $('#c-bubbles').addEventListener('change', (e) => save({ companion: { bubbles: e.target.checked } }));
    $('#c-care').addEventListener('change', (e) => save({ companion: { care: e.target.checked } }));
    $('#c-proactive').addEventListener('change', (e) => save({ companion: { proactive: e.target.checked } }));
    const saveQuiet = () =>
      save({
        companion: {
          quietHours: {
            start: Math.min(23, Math.max(0, Number($('#c-quiet-start').value) || 23)),
            end: Math.min(23, Math.max(0, Number($('#c-quiet-end').value) || 6))
          }
        }
      });
    $('#c-quiet-start').addEventListener('change', saveQuiet);
    $('#c-quiet-end').addEventListener('change', saveQuiet);
  }

  function renderNow(evt) {
    const box = $('#x-now');
    const thumb = $('#x-thumb');
    const thumbWrap = $('#x-thumb-wrap');
    if (!evt) {
      box.textContent = '还没有记录。配置云端模型后点「立即理解一次」试试。';
      thumbWrap.hidden = true;
      return;
    }
    const srcText = evt.source === 'cloud' ? '云端模型' : '基础感知（非模型）';
    box.textContent = [
      `时间：${evt.time || ''}`,
      `活动：${evt.activity || '未知'}`,
      `类别：${evt.category || ''}${evt.isWorking ? '（工作中）' : '（空闲/娱乐）'}`,
      `应用：${evt.app || '未知'}`,
      evt.note ? `观察：${evt.note}` : '',
      `来源：${srcText}`,
      evt.cloudError ? `云端提示：${evt.cloudError}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    thumb.src = `whalepal://data/screenshots/latest.jpg?t=${Date.now()}`;
    thumbWrap.hidden = false;
    thumb.onerror = () => {
      thumbWrap.hidden = true;
    };
  }

  async function refreshNow() {
    try {
      const evt = await api.invoke('context:now');
      renderNow(evt);
    } catch {
      // 忽略
    }
  }

  function bindContext() {
    $('#x-enabled').checked = cfg.context.enabled;
    $('#x-interval').value = cfg.context.intervalSec;
    $('#x-keep').checked = cfg.context.keepScreenshots;
    $('#x-enabled').addEventListener('change', (e) => save({ context: { enabled: e.target.checked } }));
    $('#x-keep').addEventListener('change', (e) => save({ context: { keepScreenshots: e.target.checked } }));
    $('#x-interval').addEventListener('change', (e) => {
      const v = Math.min(3600, Math.max(15, Number(e.target.value) || 60));
      e.target.value = v;
      save({ context: { intervalSec: v } });
    });
    $('#x-capture').addEventListener('click', async () => {
      const status = $('#x-capture-status');
      status.textContent = '正在理解屏幕…';
      try {
        const res = await api.invoke('context:capture-now');
        renderNow(res && res.event);
        status.textContent = res && res.changed ? '完成' : res && res.skipped === 'no-screen' ? '截图失败' : '画面无变化，已复用上一条';
      } catch (err) {
        status.textContent = '失败：' + String((err && err.message) || err).slice(0, 60);
      }
    });
  }

  function bindModel() {
    $('#m-preset').value = cfg.model.preset || 'custom';
    $('#m-base').value = cfg.model.baseUrl;
    $('#m-model').value = cfg.model.model;
    $('#m-key').value = cfg.model.apiKey;

    $('#m-preset').addEventListener('change', (e) => {
      const p = presets[e.target.value];
      if (p) {
        if (p.baseUrl) $('#m-base').value = p.baseUrl;
        if (p.model) $('#m-model').value = p.model;
      }
      save({
        model: {
          preset: e.target.value,
          baseUrl: $('#m-base').value,
          model: $('#m-model').value,
          extraBody: (p && p.extraBody) || {}
        }
      });
    });
    $('#m-base').addEventListener('change', (e) =>
      save({ model: { baseUrl: e.target.value.trim(), preset: 'custom', extraBody: {} } })
    );
    $('#m-model').addEventListener('change', (e) => save({ model: { model: e.target.value.trim() } }));
    $('#m-key').addEventListener('change', (e) => save({ model: { apiKey: e.target.value.trim() } }));
    $('#m-test').addEventListener('click', async () => {
      const status = $('#m-test-status');
      status.textContent = '测试中…';
      const r = await api.invoke('model:test');
      status.textContent = r.ok ? `连接成功（${r.latencyMs}ms）：${r.reply || ''}` : `失败：${r.error || '未知错误'}`;
    });
  }

  function appendChat(kind, text, source) {
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = kind;
    div.textContent = text;
    if (source) {
      const s = document.createElement('span');
      s.className = 'src';
      s.textContent = source === 'cloud' ? '（云端模型）' : '（本地记录整理）';
      div.appendChild(s);
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function bindChat() {
    const send = async () => {
      const input = $('#chat-input');
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      appendChat('q', `你：${q}`);
      appendChat('a', '小鲸正在想…');
      const placeholder = $('#chat-log').lastChild;
      const r = await api.invoke('chat:ask', q);
      placeholder.textContent = `小鲸：${r.answer}`;
      const s = document.createElement('span');
      s.className = 'src';
      s.textContent = r.source === 'cloud' ? '（云端模型）' : '（本地记录整理）';
      placeholder.appendChild(s);
      $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    };
    $('#chat-send').addEventListener('click', send);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    $('#chat-summary').addEventListener('click', async () => {
      appendChat('q', '你：生成今日摘要');
      appendChat('a', '小鲸正在整理…');
      const placeholder = $('#chat-log').lastChild;
      const r = await api.invoke('context:summary');
      placeholder.textContent = `小鲸：\n${r.text}`;
      const s = document.createElement('span');
      s.className = 'src';
      s.textContent = r.source === 'cloud' ? '（云端模型）' : '（本地记录整理）';
      placeholder.appendChild(s);
    });
  }

  async function refreshStats() {
    try {
      const s = await api.invoke('context:stats');
      const usage = s.usage || {};
      $('#d-stats').innerHTML = '';
      const items = [
        ['今天记录片段', s.todayCount || 0],
        ['其中专注片段', s.workingCount || 0],
        ['累计记录', s.total || 0],
        ['云端调用', usage.calls || 0],
        ['云端失败降级', usage.failures || 0],
        ['连续忙碌（分钟）', s.busyMinutes || 0]
      ];
      for (const [label, value] of items) {
        const div = document.createElement('div');
        div.className = 'item';
        const b = document.createElement('b');
        b.textContent = String(value);
        const span = document.createElement('span');
        span.textContent = label;
        div.appendChild(span);
        div.appendChild(b);
        $('#d-stats').appendChild(div);
      }
      $('#m-usage').textContent = `云端调用：${usage.calls || 0} 次，失败降级：${usage.failures || 0} 次`;

      // 记忆体积：把「长期记忆用文本、像素只是原料」的结论变成可见数字
      const st = s.storage;
      const storageBox = $('#d-storage');
      storageBox.innerHTML = '';
      if (st) {
        const rows = [
          ['文本记忆（事件）', `${st.eventCount} 条 · ${fmtBytes(st.eventBytes)}（平均 ${st.avgEventBytes} B/条）`],
          ['图片（仅保留最新一张）', st.imageBytes ? `1 张 · ${fmtBytes(st.imageBytes)}` : '未保留'],
          ['单张截图 ≈ 多少条文本记忆', `${st.ratioPerEvent} 条`],
          ['若按去重后每个事件存图', `${fmtBytes(st.imagePerDayDedup)}/天 · ${fmtBytes(st.imagePerMonthDedup)}/月`],
          ['若全量存图（不推荐）', `${fmtBytes(st.imagePerDayFull)}/天 · ${fmtBytes(st.imagePerMonthFull)}/月`]
        ];
        for (const [label, value] of rows) {
          const div = document.createElement('div');
          div.className = 'item';
          const span = document.createElement('span');
          span.textContent = label;
          const b = document.createElement('b');
          b.textContent = value;
          div.appendChild(span);
          div.appendChild(b);
          storageBox.appendChild(div);
        }
      }

      const recent = await api.invoke('context:recent', 12);
      const box = $('#d-events');
      box.innerHTML = '';
      if (!recent || !recent.length) {
        box.textContent = '今天还没有记录。';
      } else {
        for (const e of recent.slice().reverse()) {
          const div = document.createElement('div');
          const t = document.createElement('span');
          t.className = 't';
          t.textContent = e.time || '';
          div.appendChild(t);
          div.appendChild(document.createTextNode(`${e.activity || ''} · ${e.app || ''}${e.isWorking ? ' · 工作' : ''}`));
          box.appendChild(div);
        }
      }
    } catch {
      // 忽略
    }
  }

  function bindData() {
    $('#d-showpet').addEventListener('click', async () => {
      await api.invoke('app:show-pet');
      toast('小鲸回来啦');
    });
    $('#d-open').addEventListener('click', () => api.invoke('app:open-data-dir'));
    $('#d-clear').addEventListener('click', async () => {
      if (!window.confirm('确定清空全部上下文记录吗？此操作不可恢复。')) return;
      await api.invoke('data:clear');
      toast('已清空记录');
      refreshStats();
    });
    api.invoke('app:get-autostart').then((v) => {
      $('#d-autostart').checked = !!v;
    });
    $('#d-autostart').addEventListener('change', async (e) => {
      const enabled = await api.invoke('app:set-autostart', e.target.checked);
      e.target.checked = !!enabled;
      toast(enabled ? '已开启开机自启' : '已关闭开机自启');
    });
  }

  async function loadAbout() {
    try {
      const info = await api.invoke('app:info');
      $('#a-versions').textContent = `版本 ${info.version} · Electron ${info.electron} · Node ${info.node}`;
      $('#a-datadir').textContent = `数据目录：${info.dataDir}`;
    } catch {
      // 忽略
    }
  }

  async function init() {
    cfg = await api.invoke('config:get');
    presets = await api.invoke('config:presets');
    bindTabs();
    bindCompanion();
    bindContext();
    bindModel();
    bindChat();
    bindData();
    bindCalendar();
    cal.selected = localDateKey();
    loadAbout();
    refreshNow();
    refreshStats();
    setInterval(refreshStats, 30000);
    api.on('context:update', () => refreshNow());
    api.on('settings:goto', ({ tab }) => switchTab(tab));

    // scroll-edge：内容滚到导航下方时才出现发丝线与浅阴影
    const nav = document.getElementById('nav');
    window.addEventListener(
      'scroll',
      () => nav.classList.toggle('scrolled', window.scrollY > 8),
      { passive: true }
    );
  }

  init().catch((err) => {
    document.body.textContent = '设置加载失败：' + String((err && err.message) || err);
  });
})();
