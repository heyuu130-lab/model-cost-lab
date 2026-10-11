(function () {
  'use strict';

  const MILLION = 1000000;
  const MAX_TOKENS = 1000000000000;
  const SCRIPT_API_URL = 'https://ai-model-api.heyuu130.workers.dev/api/script';
  const MAX_SCRIPT_CHARS = 3000;
  const SCRIPT_TIMEOUT_MS = 30000;
  const scenarios = {
    code: { label: '代码修改', input: 12000, output: 3000 },
    summary: { label: '文本摘要', input: 20000, output: 1500 },
    translation: { label: '文本翻译', input: 8000, output: 8000 }
  };
  const taskPlaceholders = {
    ppt: '例如：老师让我制作一份 8 页的短视频账号运营汇报 PPT……',
    script: '例如：我要仿拍一段 3 分钟的电影桥段，只有两名演员，在教室拍摄。',
    video: '例如：我想做一条 15 秒、竖屏、节奏明快的校园活动预告。',
    visual: '例如：我要做一张适合社团招新的竖版海报，风格年轻但不要太花。',
    research: '例如：我有几篇关于短视频运营的资料，想整理成课堂讨论提纲。'
  };
  const strategyDescriptions = {
    auto: '按任务类型和已核验价格给出规则推荐，不代表实时评测。',
    quality: '偏向信息完整度和复杂任务的规则选项，不代表质量排名。',
    cost: '按输入与输出各 1,000 Token 的相同假设比较已核验价格，不代表质量判断。',
    manual: '从当前数据中手动选择模型；待核实价格不会参与成本计算。'
  };
  const state = { models: [], workflows: [], taskDetails: {}, taskPrompts: {}, filteredModels: [], sort: 'cost', provider: 'all', scenario: 'code', task: 'ppt', strategy: 'auto', scriptRequest: null };

  function isValidPrice(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function parseTokens(raw) {
    if (raw === '' || raw === null || raw === undefined) return { valid: false, reason: '请输入输入和输出 Token 数量。' };
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) return { valid: false, reason: 'Token 数量必须是有限的整数。' };
    if (value < 0) return { valid: false, reason: 'Token 数量不能为负数。' };
    if (value > MAX_TOKENS) return { valid: false, reason: 'Token 数量过大，请输入不超过 1 万亿的数值。' };
    return { valid: true, value };
  }

  function calculateCost(inputTokens, outputTokens, model) {
    if (model.pricing_status !== 'verified') return null;
    const input = parseTokens(inputTokens);
    const output = parseTokens(outputTokens);
    if (!input.valid || !output.valid) return null;
    if (!isValidPrice(model.input_price_per_million) || !isValidPrice(model.output_price_per_million)) return null;
    return (input.value / MILLION * model.input_price_per_million) + (output.value / MILLION * model.output_price_per_million);
  }

  function calculateBreakdown(inputTokens, outputTokens, model) {
    if (model.pricing_status !== 'verified') return null;
    const input = parseTokens(inputTokens);
    const output = parseTokens(outputTokens);
    if (!input.valid || !output.valid || !isValidPrice(model.input_price_per_million) || !isValidPrice(model.output_price_per_million)) return null;
    const inputCost = input.value / MILLION * model.input_price_per_million;
    const outputCost = output.value / MILLION * model.output_price_per_million;
    return { inputCost: inputCost, outputCost: outputCost, total: inputCost + outputCost };
  }

  function formatMoney(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '待核实';
    if (value === 0) return '$0.00';
    if (Math.abs(value) < 0.01) {
      const fixed = value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
      return '$' + fixed;
    }
    return '$' + value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatPrice(value) {
    return isValidPrice(value) ? formatMoney(value) : '待核实';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function getTokens() {
    return {
      input: document.querySelector('#input-tokens').value,
      output: document.querySelector('#output-tokens').value
    };
  }

  function updateError(message) {
    document.querySelector('#input-error').textContent = message || '';
  }

  function verifiedModels() {
    return state.models.filter(function (model) {
      return model.pricing_status === 'verified' && isValidPrice(model.input_price_per_million) && isValidPrice(model.output_price_per_million);
    });
  }

  function preferredModel() {
    const verified = verifiedModels();
    if (!verified.length) return null;
    if (state.strategy === 'manual') {
      return verified.find(function (model) { return model.model_id === document.querySelector('#manual-model').value; }) || verified[0];
    }
    if (state.strategy === 'cost') {
      return verified.slice().sort(function (a, b) { return calculateCost(1000, 1000, a) - calculateCost(1000, 1000, b); })[0];
    }
    return null;
  }

  function currentWorkflow() {
    return state.workflows.find(function (item) { return item.id === state.task; });
  }

  function saveTaskFields() {
    const values = {};
    document.querySelectorAll('#task-fields input').forEach(function (input) { values[input.dataset.field] = input.value.trim(); });
    state.taskDetails[state.task] = values;
  }

  function renderTaskFields() {
    const workflow = currentWorkflow();
    if (!workflow) return;
    const values = state.taskDetails[state.task] || {};
    document.querySelector('#task-fields').innerHTML = '<div class="task-fields-heading"><strong>关键信息</strong><span>可选，帮助你检查还有哪些要求未说明</span></div>' + workflow.fields.map(function (field) {
      return '<label>' + escapeHtml(field) + '<input type="text" data-field="' + escapeHtml(field) + '" value="' + escapeHtml(values[field] || '') + '" maxlength="400" placeholder="待填写"></label>';
    }).join('');
  }

  function renderManualModels() {
    const select = document.querySelector('#manual-model');
    if (!select) return;
    const current = select.value;
    select.innerHTML = state.models.map(function (model) {
      const verified = model.pricing_status === 'verified' && isValidPrice(model.input_price_per_million) && isValidPrice(model.output_price_per_million);
      return '<option value="' + escapeHtml(model.model_id) + '"' + (verified ? '' : ' disabled') + '>' + escapeHtml(model.display_name) + '（' + (verified ? '价格已核验' : '待核实，暂不可选') + '）</option>';
    }).join('');
    if (current && verifiedModels().some(function (model) { return model.model_id === current; })) select.value = current;
  }

  function renderWorkspaceControls() {
    document.querySelectorAll('[data-task]').forEach(function (button) {
      const selected = button.dataset.task === state.task;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const prompt = document.querySelector('#task-prompt');
    const workflow = state.workflows.find(function (item) { return item.id === state.task; });
    if (prompt && workflow) prompt.placeholder = workflow.prompt || taskPlaceholders[state.task];
    if (prompt) autosizePrompt(prompt);
    renderTaskFields();
    const strategy = document.querySelector('#model-strategy');
    if (strategy) {
      strategy.value = state.task === 'script' ? 'auto' : state.strategy;
      strategy.disabled = state.task === 'script';
    }
    const description = document.querySelector('#strategy-description');
    if (description) description.textContent = state.task === 'script'
      ? '脚本生成试点固定使用 DeepSeek Flash；模型策略暂不影响这次真实调用。'
      : strategyDescriptions[state.strategy];
    const manualWrap = document.querySelector('#manual-model-wrap');
    if (manualWrap) manualWrap.hidden = state.task === 'script' || state.strategy !== 'manual';
    document.querySelector('#workspace-mode').textContent = state.task === 'script' ? 'DeepSeek 生成入口' : '演示模式';
    document.querySelector('#run-task').firstChild.textContent = state.task === 'script' ? '生成脚本与分镜 ' : '整理这个任务 ';
    document.querySelector('#script-access').hidden = state.task !== 'script';
    renderManualModels();
  }

  function autosizePrompt(prompt) {
    if (!prompt) return;
    prompt.style.height = 'auto';
    const nextHeight = Math.min(Math.max(prompt.scrollHeight, 62), 240);
    prompt.style.height = nextHeight + 'px';
    prompt.style.overflowY = prompt.scrollHeight > 240 ? 'auto' : 'hidden';
  }

  function submitTask() {
    const prompt = document.querySelector('#task-prompt').value.trim();
    if (!prompt) {
      document.querySelector('#workspace-status').textContent = '请先写下你的任务目标或限制条件。';
      document.querySelector('#task-prompt').focus();
      return;
    }
    if (state.task === 'script' && prompt.length > MAX_SCRIPT_CHARS) {
      document.querySelector('#workspace-status').textContent = '脚本任务描述最多 3,000 个字符。';
      return;
    }
    if (state.task === 'script' && Object.values(state.taskDetails.script || {}).some(function (value) { return value.length > 400; })) {
      document.querySelector('#workspace-status').textContent = '每项脚本补充要求最多 400 个字符。';
      return;
    }
    if (state.task === 'script' && !document.querySelector('#access-token').value.trim()) {
      document.querySelector('#workspace-status').textContent = '请先输入个人访问令牌，再生成脚本与分镜。';
      document.querySelector('#access-token').focus();
      return;
    }
    document.querySelector('#workspace-status').textContent = '';
    renderWorkflowResult();
    if (state.task === 'script') generateScript();
  }

  function selectTask(name) {
    if (!state.workflows.some(function (item) { return item.id === name; })) return;
    saveTaskFields();
    state.taskPrompts[state.task] = document.querySelector('#task-prompt').value;
    state.task = name;
    document.querySelector('#task-prompt').value = state.taskPrompts[name] || '';
    document.querySelector('#workspace-status').textContent = '';
    renderWorkspaceControls();
  }

  function renderWorkflowResult() {
    const workflow = state.workflows.find(function (item) { return item.id === state.task; });
    if (!workflow) return;
    const prompt = document.querySelector('#task-prompt').value.trim() || workflow.prompt;
    const model = preferredModel();
    saveTaskFields();
    const details = state.taskDetails[state.task] || {};
    document.querySelector('#workflow-title').textContent = workflow.name;
    document.querySelector('#workflow-description').textContent = workflow.description;
    document.querySelector('#workflow-task-label').textContent = '任务：' + workflow.name;
    document.querySelector('#workflow-model-label').textContent = state.task === 'script'
      ? '执行模型：DeepSeek Flash（本阶段固定）'
      : model ? (state.strategy === 'cost' ? '成本优先候选：' : '手动选择：') + model.display_name : '模型偏好：' + (state.strategy === 'quality' ? '质量优先，缺少评测依据，暂不指定模型' : '自动推荐，缺少任务适用性证据，暂不指定模型');
    document.querySelector('#workflow-prompt').textContent = prompt;
    document.querySelector('#workflow-constraints').innerHTML = workflow.fields.map(function (field) {
      return '<div><dt>' + escapeHtml(field) + '</dt><dd>' + escapeHtml(details[field] || '待补充') + '</dd></div>';
    }).join('');
    document.querySelector('#workflow-steps').innerHTML = workflow.steps.map(function (step) { return '<li><span>' + escapeHtml(step) + '</span><small>预设参考</small></li>'; }).join('');
    document.querySelector('#workflow-output-text').textContent = workflow.expected_output;
    document.querySelector('#workflow-mode').textContent = state.task === 'script' ? '等待模型响应' : '预设演示结果';
    document.querySelector('#workflow-disclaimer').textContent = state.task === 'script'
      ? '任务要求、参考步骤和预期交付来自本地预设；下方结果才由真实模型生成。'
      : '这不是实时 AI 生成内容，而是根据任务类型准备的本地演示结构。它用于帮助你判断工作流是否符合需要。';
    document.querySelector('#workflow-live').hidden = state.task !== 'script';
    document.querySelector('#workspace-editor').hidden = true;
    document.querySelector('#workspace-result').hidden = false;
    document.querySelector('#workspace-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function generateScript() {
    if (state.scriptRequest) return;
    let accessToken = document.querySelector('#access-token').value.trim();
    const panel = document.querySelector('#workflow-live');
    const status = document.querySelector('#workflow-live-status');
    const content = document.querySelector('#workflow-live-content');
    const usage = document.querySelector('#workflow-live-usage');
    const retry = document.querySelector('#retry-script');
    if (!accessToken) {
      status.textContent = '请返回修改任务并输入个人访问令牌。';
      retry.hidden = true;
      return;
    }
    const controller = new AbortController();
    let headers;
    let serviceMessage = '';
    state.scriptRequest = controller;
    panel.hidden = false;
    status.textContent = '正在请求 DeepSeek 生成。当前任务文字会发送给 DeepSeek，不会在本站保存。';
    content.hidden = true;
    usage.hidden = true;
    retry.hidden = true;
    const timeout = setTimeout(function () { controller.abort(); }, SCRIPT_TIMEOUT_MS);
    try {
      headers = new Headers({ 'Content-Type': 'application/json', 'X-App-Access-Token': accessToken });
      const response = await fetch(SCRIPT_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task: 'script', prompt: document.querySelector('#task-prompt').value.trim(), requirements: state.taskDetails.script || {} }),
        signal: controller.signal
      });
      if (response.status === 401) {
        serviceMessage = '访问令牌无效。请返回修改任务，检查令牌后重试。';
        throw new Error('REQUEST_FAILED');
      }
      const result = await response.json();
      if (!response.ok) {
        serviceMessage = result.error?.message || '生成服务暂时不可用。';
        throw new Error('REQUEST_FAILED');
      }
      if (result.mode !== 'live' || result.task !== 'script' || typeof result.content !== 'string' || !result.content.trim()) {
        serviceMessage = '服务返回的数据格式不正确。';
        throw new Error('REQUEST_FAILED');
      }
      if (state.scriptRequest !== controller) return;
      content.textContent = result.content;
      content.hidden = false;
      const inputTokens = result.usage?.input_tokens;
      const outputTokens = result.usage?.output_tokens;
      usage.textContent = Number.isInteger(inputTokens) && Number.isInteger(outputTokens)
        ? 'DeepSeek 返回用量：输入 ' + inputTokens.toLocaleString('en-US') + ' Token，输出 ' + outputTokens.toLocaleString('en-US') + ' Token。实际费用以供应商账单为准。'
        : '供应商未返回可展示的 Token 用量，实际费用以供应商账单为准。';
      usage.hidden = false;
      status.textContent = '已收到 DeepSeek 的真实生成结果。请核对事实与拍摄条件。';
      document.querySelector('#workflow-mode').textContent = '真实生成结果';
    } catch (error) {
      if (state.scriptRequest !== controller) return;
      status.textContent = error.name === 'AbortError'
        ? '请求超时。请稍后重试；如果模型已经处理请求，供应商仍可能产生费用。'
        : error instanceof SyntaxError ? '服务返回格式不正确。请确认 Worker 已部署。'
          : serviceMessage || (error instanceof TypeError
            ? '无法连接生成服务。请检查 Worker 部署、网络和 CORS 设置。'
            : '生成请求未完成。请检查输入后重试。');
      document.querySelector('#workflow-mode').textContent = '生成失败';
      retry.hidden = false;
    } finally {
      headers?.delete('X-App-Access-Token');
      accessToken = null;
      clearTimeout(timeout);
      if (state.scriptRequest === controller) state.scriptRequest = null;
    }
  }

  function attachWorkspaceEvents() {
    const accessInput = document.querySelector('#access-token');
    accessInput.value = '';
    window.addEventListener('pageshow', function (event) { if (event.persisted) accessInput.value = ''; });
    document.querySelectorAll('[data-task]').forEach(function (button) {
      button.addEventListener('click', function () { selectTask(button.dataset.task); });
    });
    document.querySelector('#model-strategy').addEventListener('change', function (event) {
      state.strategy = event.target.value;
      renderWorkspaceControls();
    });
    document.querySelector('#task-fields').addEventListener('input', saveTaskFields);
    document.querySelector('#run-task').addEventListener('click', submitTask);
    document.querySelector('#task-prompt').addEventListener('input', function (event) {
      state.taskPrompts[state.task] = event.target.value;
      autosizePrompt(event.target);
    });
    document.querySelector('#task-prompt').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitTask();
      }
    });
    document.querySelector('#edit-task').addEventListener('click', function () {
      if (state.scriptRequest) {
        state.scriptRequest.abort();
        state.scriptRequest = null;
      }
      document.querySelector('#workspace-result').hidden = true;
      document.querySelector('#workspace-editor').hidden = false;
      document.querySelector('#workspace-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.querySelector('#retry-script').addEventListener('click', generateScript);
    renderWorkspaceControls();
  }

  function applyView() {
    const requested = window.location.hash.replace('#', '') || 'workspace';
    const activeId = ['workspace', 'models', 'calculator', 'about', 'feedback'].indexOf(requested) >= 0 ? requested : 'workspace';
    document.querySelectorAll('.app-view').forEach(function (view) {
      view.classList.toggle('is-active', view.id === activeId);
    });
    document.querySelectorAll('[data-view-link]').forEach(function (link) {
      const selected = link.dataset.viewLink === activeId;
      link.classList.toggle('is-active', selected);
      link.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    window.scrollTo(0, 0);
  }

  function sortModels(models, tokens) {
    return models.slice().sort(function (a, b) {
      if (a.pricing_status !== b.pricing_status) return a.pricing_status === 'verified' ? -1 : 1;
      const aCost = calculateCost(tokens.input, tokens.output, a);
      const bCost = calculateCost(tokens.input, tokens.output, b);
      if (state.sort === 'input') return (a.input_price_per_million ?? Infinity) - (b.input_price_per_million ?? Infinity);
      if (state.sort === 'output') return (a.output_price_per_million ?? Infinity) - (b.output_price_per_million ?? Infinity);
      if (aCost === null && bCost === null) return a.display_name.localeCompare(b.display_name);
      if (aCost === null) return 1;
      if (bCost === null) return -1;
      return aCost - bCost;
    });
  }

  function renderResults() {
    const tokens = getTokens();
    renderUsageSummary();
    const input = parseTokens(tokens.input);
    const output = parseTokens(tokens.output);
    const error = input.valid ? (output.valid ? '' : output.reason) : input.reason;
    updateError(error);
    const models = sortModels(state.filteredModels, tokens);
    const html = models.map(function (model) {
      const breakdown = error ? null : calculateBreakdown(tokens.input, tokens.output, model);
      const verified = model.pricing_status === 'verified' && breakdown !== null;
      const resultLabel = error ? '输入无效' : (verified ? formatMoney(breakdown.total) : '待核实');
      const resultCaption = error ? '修正 Token 后计算' : (verified ? '预估总费用' : '暂不计算');
      return '<article class="result-card ' + (verified ? '' : 'pending') + '">' +
        '<div class="result-model"><strong>' + escapeHtml(model.display_name) + '</strong><span>' + escapeHtml(model.provider) + ' · ' + escapeHtml(model.model_id) + '</span></div>' +
        '<div class="result-prices">输入价格 ' + formatPrice(model.input_price_per_million) + ' / 1M<br>输出价格 ' + formatPrice(model.output_price_per_million) + ' / 1M</div>' +
        '<div class="result-cost"><strong>' + resultLabel + '</strong><span>' + resultCaption + '</span></div>' +
        '<div class="result-breakdown">' + (error ? '请填写有效的输入和输出 Token' : (verified ? ('输入费用 ' + formatMoney(breakdown.inputCost) + ' · 输出费用 ' + formatMoney(breakdown.outputCost)) : '价格或版本尚未核验')) + '</div>' +
        '<div class="result-source"><a href="' + escapeHtml(model.source_url) + '" target="_blank" rel="noopener noreferrer">官方来源 ↗</a><span>' + (model.pricing_status === 'verified' ? '价格核验日期：' : '资料检查日期：') + escapeHtml(model.checked_at) + '</span><small>' + escapeHtml(model.pricing_notes) + '</small></div>' +
        '</article>';
    }).join('');
    document.querySelector('#results').innerHTML = html || '<p class="section-intro">没有符合筛选条件的模型。</p>';
  }

  function renderUsageSummary() {
    const tokens = getTokens();
    const input = parseTokens(tokens.input);
    const output = parseTokens(tokens.output);
    const scenario = scenarios[state.scenario];
    const label = state.scenario === 'manual' ? '手动输入' : scenario.label;
    document.querySelector('#usage-summary').innerHTML = '<strong>' + escapeHtml(label) + '</strong><span>输入 Token：' + (input.valid ? input.value.toLocaleString('en-US') : '待输入') + '</span><span>输出 Token：' + (output.valid ? output.value.toLocaleString('en-US') : '待输入') + '</span>';
  }

  function renderScenarioAssumption() {
    const assumption = document.querySelector('#scenario-assumption');
    if (state.scenario === 'manual') {
      assumption.textContent = '手动输入模式：下面的数量由你决定，不代表任何模型的真实平均用量。';
      return;
    }
    const scenario = scenarios[state.scenario];
    assumption.textContent = '演示假设：' + scenario.label + '，输入 ' + scenario.input.toLocaleString('en-US') + ' Token，输出 ' + scenario.output.toLocaleString('en-US') + ' Token。这个数量只用于展示，可随时修改。';
  }

  function selectScenario(name) {
    state.scenario = name;
    document.querySelectorAll('[data-scenario]').forEach(function (button) {
      const selected = button.dataset.scenario === name;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (name !== 'manual') {
      document.querySelector('#input-tokens').value = scenarios[name].input;
      document.querySelector('#output-tokens').value = scenarios[name].output;
    }
    renderScenarioAssumption();
    renderResults();
  }

  function renderPriceTable() {
    const rows = state.models.filter(function (model) { return state.provider === 'all' || model.provider === state.provider; });
    document.querySelector('#price-table-body').innerHTML = rows.map(function (model) {
      const verified = model.pricing_status === 'verified';
      return '<tr>' +
        '<td><span class="model-name">' + escapeHtml(model.display_name) + '</span><span class="model-id">' + escapeHtml(model.model_id) + '</span></td>' +
        '<td class="price-value ' + (isValidPrice(model.input_price_per_million) ? '' : 'price-na') + '">' + formatPrice(model.input_price_per_million) + '</td>' +
        '<td class="price-value ' + (isValidPrice(model.output_price_per_million) ? '' : 'price-na') + '">' + formatPrice(model.output_price_per_million) + '</td>' +
        '<td><span class="status-chip ' + (verified ? 'verified' : 'pending') + '">' + (verified ? '已核验' : '待核实') + '</span><span class="pricing-note">' + escapeHtml(model.pricing_notes) + '</span></td>' +
        '<td><a class="source-link" href="' + escapeHtml(model.source_url) + '" target="_blank" rel="noopener noreferrer">官方来源 ↗</a><span class="checked-at">' + (verified ? '价格核验日期：' : '资料检查日期：') + escapeHtml(model.checked_at) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  function populateProviders() {
    const providers = Array.from(new Set(state.models.map(function (model) { return model.provider; })));
    document.querySelector('#provider-filter').innerHTML = '<option value="all">全部供应商</option>' + providers.map(function (provider) {
      return '<option value="' + escapeHtml(provider) + '">' + escapeHtml(provider) + '</option>';
    }).join('');
  }

  function refresh() {
    state.filteredModels = state.models.filter(function (model) { return state.provider === 'all' || model.provider === state.provider; });
    renderResults();
    renderPriceTable();
  }

  function attachEvents() {
    document.querySelector('#calculator-form').addEventListener('submit', function (event) { event.preventDefault(); });
    ['#input-tokens', '#output-tokens'].forEach(function (selector) {
      document.querySelector(selector).addEventListener('input', function () {
        state.scenario = 'manual';
        document.querySelectorAll('[data-scenario]').forEach(function (button) {
          const selected = button.dataset.scenario === 'manual';
          button.classList.toggle('is-selected', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
        renderScenarioAssumption();
        renderResults();
      });
    });
    document.querySelector('#sort-mode').addEventListener('change', function (event) {
      state.sort = event.target.value;
      renderResults();
    });
    document.querySelector('#provider-filter').addEventListener('change', function (event) {
      state.provider = event.target.value;
      refresh();
    });
    document.querySelectorAll('[data-scenario]').forEach(function (button) {
      button.addEventListener('click', function () { selectScenario(button.dataset.scenario); });
    });
    document.querySelector('#copy-feedback').addEventListener('click', copyFeedback);
  }

  async function copyFeedback() {
    const values = {
      problem: document.querySelector('#feedback-problem').value.trim() || '未填写',
      models: document.querySelector('#feedback-models').value.trim() || '未填写',
      tasks: document.querySelector('#feedback-tasks').value.trim() || '未填写',
      other: document.querySelector('#feedback-other').value.trim() || '未填写'
    };
    const text = 'Model Cost Lab 试用反馈\n\n使用过程中遇到的问题：' + values.problem + '\n\n希望增加的模型：' + values.models + '\n\n希望支持的任务类型：' + values.tasks + '\n\n其他建议：' + values.other;
    const status = document.querySelector('#feedback-status');
    const fallback = document.querySelector('#feedback-fallback');
    fallback.hidden = true;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = '反馈模板已复制。请粘贴到你的邮件或社区消息中。';
    } catch (error) {
      document.querySelector('#feedback-copy-text').value = text;
      fallback.hidden = false;
      status.textContent = '浏览器未允许自动复制。请从下方文本框手动复制反馈内容。';
    }
  }

  async function init() {
    try {
      const responses = await Promise.all([
        fetch('data/models.json', { cache: 'no-store' }),
        fetch('data/workflows.json', { cache: 'no-store' })
      ]);
      responses.forEach(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); });
      const payload = await responses[0].json();
      const workflowPayload = await responses[1].json();
      if (!payload || !Array.isArray(payload.models)) throw new Error('模型数据格式无效');
      if (!workflowPayload || !Array.isArray(workflowPayload.workflows)) throw new Error('工作流数据格式无效');
      state.models = payload.models;
      state.workflows = workflowPayload.workflows;
      populateProviders();
      attachEvents();
      attachWorkspaceEvents();
      applyView();
      window.addEventListener('hashchange', applyView);
      renderScenarioAssumption();
      document.querySelector('#data-status').textContent = '已载入 ' + state.models.length + ' 条模型记录；仅“已核验”记录参与费用计算。';
      refresh();
    } catch (error) {
      document.querySelector('#data-status').className = 'data-status error';
      document.querySelector('#data-status').textContent = '价格数据读取失败：' + error.message + '。请通过本地服务器启动页面。';
      document.querySelector('#results').innerHTML = '<p class="section-intro">当前无法读取模型数据。</p>';
    }
  }

  window.ModelCostLab = { calculateCost: calculateCost, formatMoney: formatMoney, parseTokens: parseTokens };
  document.addEventListener('DOMContentLoaded', init);
}());
