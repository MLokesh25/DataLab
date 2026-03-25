const API_ROOT = 'https://api.worldbank.org/v2';

const INDICATORS = {
  'NY.GDP.MKTP.CD': 'GDP (current US$)',
  'SP.POP.TOTL': 'Population, total',
  'SP.DYN.LE00.IN': 'Life expectancy at birth',
  'EN.ATM.CO2E.PC': 'CO₂ emissions (metric tons per capita)',
  'SE.ADT.LITR.ZS': 'Adult literacy rate (%)',
};

const els = {
  globalStats: document.getElementById('globalStats'),
  refreshGlobal: document.getElementById('refreshGlobal'),
  countrySelect: document.getElementById('countrySelect'),
  indicatorSelect: document.getElementById('indicatorSelect'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  analysisSummary: document.getElementById('analysisSummary'),
  countryA: document.getElementById('countryA'),
  countryB: document.getElementById('countryB'),
  compareBtn: document.getElementById('compareBtn'),
  compareResult: document.getElementById('compareResult'),
};

let trendChart;
let countries = [];

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

async function fetchJson(path) {
  const res = await fetch(`${API_ROOT}${path}${path.includes('?') ? '&' : '?'}format=json`);
  if (!res.ok) throw new Error('Failed request');
  return res.json();
}

function fillSelect(selectEl, options) {
  selectEl.innerHTML = options
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join('');
}

function formatValue(v) {
  if (v === null || Number.isNaN(v)) return 'n/a';
  if (Math.abs(v) >= 1e12) return `${numberFmt.format(v / 1e12)}T`;
  if (Math.abs(v) >= 1e9) return `${numberFmt.format(v / 1e9)}B`;
  if (Math.abs(v) >= 1e6) return `${numberFmt.format(v / 1e6)}M`;
  return numberFmt.format(v);
}

function linearRegression(points) {
  const n = points.length;
  const xMean = points.reduce((s, p) => s + p.x, 0) / n;
  const yMean = points.reduce((s, p) => s + p.y, 0) / n;

  const num = points.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0);
  const den = points.reduce((s, p) => s + (p.x - xMean) ** 2, 0) || 1;
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

async function loadCountries() {
  const [, rows] = await fetchJson('/country?per_page=400');
  countries = rows
    .filter((c) => c.region?.id !== 'NA' && c.capitalCity)
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  fillSelect(els.countrySelect, countries);
  fillSelect(els.countryA, countries);
  fillSelect(els.countryB, countries);

  els.countrySelect.value = 'USA';
  els.countryA.value = 'USA';
  els.countryB.value = 'CHN';
}

async function loadGlobalSnapshot() {
  els.globalStats.innerHTML = '<p>Loading global metrics…</p>';

  const latestYear = new Date().getUTCFullYear() - 1;
  const entries = await Promise.all(
    Object.entries(INDICATORS).map(async ([code, label]) => {
      const [, rows] = await fetchJson(`/country/WLD/indicator/${code}?date=${latestYear}&per_page=5`);
      const best = rows?.find((r) => typeof r.value === 'number') || rows?.[0];
      return { label, value: best?.value ?? null, year: best?.date ?? latestYear };
    }),
  );

  els.globalStats.innerHTML = entries
    .map(
      (e) => `
      <article class="kpi">
        <h3>${e.label}</h3>
        <p>${formatValue(e.value)}</p>
        <small>Year: ${e.year}</small>
      </article>
    `,
    )
    .join('');
}

async function analyzeCountryTrend() {
  const country = els.countrySelect.value;
  const indicator = els.indicatorSelect.value;

  els.analysisSummary.textContent = 'Analyzing time series…';

  const [, rows] = await fetchJson(`/country/${country}/indicator/${indicator}?date=2000:2025&per_page=100`);
  const series = (rows || [])
    .filter((r) => typeof r.value === 'number')
    .map((r) => ({ year: Number(r.date), value: Number(r.value) }))
    .sort((a, b) => a.year - b.year);

  if (series.length < 3) {
    els.analysisSummary.textContent = 'Not enough data points for trend analysis.';
    return;
  }

  const reg = linearRegression(series.map((d) => ({ x: d.year, y: d.value })));
  const latest = series.at(-1);
  const prev = series.at(-2);
  const yoy = ((latest.value - prev.value) / Math.abs(prev.value || 1)) * 100;
  const nextYearEstimate = reg.slope * (latest.year + 1) + reg.intercept;
  const direction = reg.slope > 0 ? 'upward' : 'downward';

  els.analysisSummary.innerHTML = `
    <p><strong>Trend:</strong> ${direction} (${formatValue(reg.slope)} units/year)</p>
    <p><strong>Latest:</strong> ${formatValue(latest.value)} in ${latest.year}</p>
    <p><strong>YoY change:</strong> ${numberFmt.format(yoy)}%</p>
    <p><strong>Forecast (${latest.year + 1}):</strong> ${formatValue(nextYearEstimate)}</p>
  `;

  renderTrendChart(series, nextYearEstimate);
}

function renderTrendChart(series, forecast) {
  const labels = [...series.map((d) => d.year), series.at(-1).year + 1];
  const values = [...series.map((d) => d.value), forecast];

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Historical + forecast',
          data: values,
          borderColor: '#66d9ff',
          backgroundColor: '#66d9ff44',
          pointRadius: 2,
          tension: 0.2,
          fill: true,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dbe8ff' } },
      },
      scales: {
        x: { ticks: { color: '#9cb1d9' } },
        y: { ticks: { color: '#9cb1d9' } },
      },
    },
  });
}

async function compareCountries() {
  const a = els.countryA.value;
  const b = els.countryB.value;
  const indicator = els.indicatorSelect.value;
  const indicatorLabel = INDICATORS[indicator];

  els.compareResult.textContent = 'Fetching latest values…';

  const [[, dataA], [, dataB]] = await Promise.all([
    fetchJson(`/country/${a}/indicator/${indicator}?date=2010:2025&per_page=20`),
    fetchJson(`/country/${b}/indicator/${indicator}?date=2010:2025&per_page=20`),
  ]);

  const latestA = dataA?.find((d) => typeof d.value === 'number');
  const latestB = dataB?.find((d) => typeof d.value === 'number');

  if (!latestA || !latestB) {
    els.compareResult.textContent = 'Comparison unavailable due to missing recent values.';
    return;
  }

  const diff = latestA.value - latestB.value;
  const leader = diff > 0 ? latestA.country.value : latestB.country.value;

  els.compareResult.innerHTML = `
    <p><strong>${indicatorLabel}</strong></p>
    <p>${latestA.country.value}: ${formatValue(latestA.value)} (${latestA.date})</p>
    <p>${latestB.country.value}: ${formatValue(latestB.value)} (${latestB.date})</p>
    <p><strong>Higher value:</strong> ${leader} by ${formatValue(Math.abs(diff))}</p>
  `;
}

function setupIndicators() {
  const indicatorOptions = Object.entries(INDICATORS).map(([value, label]) => ({ value, label }));
  fillSelect(els.indicatorSelect, indicatorOptions);
  els.indicatorSelect.value = 'NY.GDP.MKTP.CD';
}

function bindEvents() {
  els.refreshGlobal.addEventListener('click', loadGlobalSnapshot);
  els.analyzeBtn.addEventListener('click', analyzeCountryTrend);
  els.compareBtn.addEventListener('click', compareCountries);
}

async function init() {
  try {
    setupIndicators();
    bindEvents();
    await loadCountries();
    await loadGlobalSnapshot();
    await analyzeCountryTrend();
    await compareCountries();
  } catch (error) {
    console.error(error);
    els.globalStats.innerHTML = '<p>Data loading failed. Please retry in a few seconds.</p>';
    els.analysisSummary.textContent = 'Initialization failed due to a network or API issue.';
  }
}

init();
