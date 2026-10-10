(function () {
  'use strict';

  const MILLION = 1000000;
  const MAX_TOKENS = 1000000000000;
  const scenarios = {
    code: { label: '代码修改', input: 12000, output: 3000 },
    summary: { label: '文本摘要', input: 20000, output: 1500 },
    translation: { label: '文本翻译', input: 8000, output: 8000 }
  };
  const state = { models: [], filteredModels: [], sort: 'cost', provider: 'all', scenario: 'code' };

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
      const response = await fetch('data/models.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.models)) throw new Error('模型数据格式无效');
      state.models = payload.models;
      populateProviders();
      attachEvents();
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
