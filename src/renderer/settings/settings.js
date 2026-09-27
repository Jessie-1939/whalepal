/* 设置窗口：配置读写、立即理解、云端模型测试、上下文对话、数据管理。 */
(function () {
  const api = window.whalePal;
  const $ = (s) => document.querySelector(s);

  const PRESETS = {
    doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-flash-250828' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    custom: null
  };

  let cfg = null;
  let toastTimer = null;

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  async function save(patch) {
    cfg = await api.invoke('config:set', patch);
    toast('已保存');
  }

  function bindTabs() {
    const buttons = document.querySelectorAll('#tabs button');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.toggle('active', b === btn);
        for (const sec of document.querySelectorAll('main section')) {
          sec.hidden = sec.id !== `tab-${btn.dataset.tab}`;
        }
        if (btn.dataset.tab === 'data') refreshStats();
        if (btn.dataset.tab === 'context') refreshNow();
      });
    }
  }

  function bindCompanion() {
    $('#c-name').value = cfg.companion.name;
    $('#c-self').value = cfg.companion.selfName;
    $('#c-visible').checked = cfg.companion.visible;
    $('#c-walk').checked = cfg.companion.walk;
    $('#c-bubbles').checked = cfg.companion.bubbles;
    $('#c-care').checked = cfg.companion.care;
    $('#c-quiet-start').value = cfg.companion.quietHours.start;
    $('#c-quiet-end').value = cfg.companion.quietHours.end;

    $('#c-name').addEventListener('change', (e) => save({ companion: { name: e.target.value || '主人' } }));
    $('#c-self').addEventListener('change', (e) => save({ companion: { selfName: e.target.value || '小鲸' } }));
    $('#c-visible').addEventListener('change', (e) => save({ companion: { visible: e.target.checked } }));
    $('#c-walk').addEventListener('change', (e) => save({ companion: { walk: e.target.checked } }));
    $('#c-bubbles').addEventListener('change', (e) => save({ companion: { bubbles: e.target.checked } }));
    $('#c-care').addEventListener('change', (e) => save({ companion: { care: e.target.checked } }));
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
    if (!evt) {
      box.textContent = '还没有记录。配置云端模型后点「立即理解一次」试试。';
      thumb.hidden = true;
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
    thumb.hidden = false;
    thumb.onerror = () => {
      thumb.hidden = true;
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
      const p = PRESETS[e.target.value];
      if (p) {
        $('#m-base').value = p.baseUrl;
        $('#m-model').value = p.model;
      }
      save({ model: { preset: e.target.value, baseUrl: $('#m-base').value, model: $('#m-model').value } });
    });
    $('#m-base').addEventListener('change', (e) => save({ model: { baseUrl: e.target.value.trim(), preset: 'custom' } }));
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
        div.appendChild(b);
        div.appendChild(span);
        $('#d-stats').appendChild(div);
      }
      $('#m-usage').textContent = `云端调用：${usage.calls || 0} 次，失败降级：${usage.failures || 0} 次`;

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
    bindTabs();
    bindCompanion();
    bindContext();
    bindModel();
    bindChat();
    bindData();
    loadAbout();
    refreshNow();
    refreshStats();
    setInterval(refreshStats, 30000);
    api.on('context:update', () => refreshNow());
  }

  init().catch((err) => {
    document.body.textContent = '设置加载失败：' + String((err && err.message) || err);
  });
})();
