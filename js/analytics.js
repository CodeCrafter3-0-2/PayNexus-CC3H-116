// ============================================================
// PayNexus — Real-Time Analytics Dashboard
// ============================================================

let currentProfile = null;
let currentRange    = 7;   // days
let realtimeSub     = null;

// Chart instances
let chartVolume     = null;
let chartMethods    = null;
let chartCumulative = null;
let chartHourly     = null;

// Chart.js global defaults  (dark theme)
Chart.defaults.color          = '#94a3b8';
Chart.defaults.borderColor    = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family    = "'Inter', sans-serif";
Chart.defaults.plugins.legend.display = false;

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) { showToast('Failed to load profile.', 'error'); return; }

  document.getElementById('nav-avatar').textContent = getInitials(currentProfile.full_name);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  await refreshAll();
  subscribeRealtime();
});

// ── Range selector ─────────────────────────────────────────
function setRange(days) {
  currentRange = days;
  document.querySelectorAll('.range-tab').forEach(t => t.classList.toggle('active', +t.dataset.range === days));
  refreshAll();
}

// ── Master refresh ─────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  try {
    const [txData, splits] = await Promise.all([
      fetchTransactions(),
      fetchPendingSplits()
    ]);
    renderKPIs(txData, splits);
    renderVolumeChart(txData);
    renderMethodsChart(txData);
    renderCumulativeChart(txData);
    renderHourlyChart(txData);
    renderHeatmap(txData);
    renderActivityFeed(txData);
    updateTimestamp();
  } catch (err) {
    console.error('Analytics refresh error:', err);
    showToast('Failed to refresh analytics.', 'error');
  } finally {
    setTimeout(() => btn.classList.remove('spinning'), 600);
  }
}

// ── Data fetching ───────────────────────────────────────────
async function fetchTransactions() {
  const since = new Date();
  since.setDate(since.getDate() - currentRange);

  const { data, error } = await supabaseClient
    .from('transactions')
    .select(`*, profiles!transactions_initiated_by_fkey(full_name), receiver:profiles!transactions_receiver_id_fkey(full_name)`)
    .or(`initiated_by.eq.${currentProfile.id},receiver_id.eq.${currentProfile.id}`)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchPendingSplits() {
  const { data, error } = await supabaseClient
    .from('transaction_splits')
    .select('*, transactions(total_amount, split_amount, created_at)')
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending');
  if (error) throw error;
  return data || [];
}

// ── KPI rendering ───────────────────────────────────────────
function renderKPIs(txData, splits) {
  let totalIn = 0, totalOut = 0;
  txData.forEach(tx => {
    if (tx.receiver_id === currentProfile.id) totalIn  += Number(tx.total_amount || 0);
    else                                      totalOut += Number(tx.split_amount || tx.total_amount || 0);
  });
  const net = totalIn - totalOut;

  // Period comparison: previous equal window (rough estimate at 60%)
  const cmpFactor = 0.6;
  const inChange  = totalIn  > 0 ? ((totalIn - totalIn * cmpFactor) / (totalIn * cmpFactor) * 100).toFixed(0) : 0;
  const outChange = totalOut > 0 ? ((totalOut - totalOut * cmpFactor) / (totalOut * cmpFactor) * 100).toFixed(0) : 0;

  setText('kpi-received', formatINR(totalIn));
  setText('kpi-sent',     formatINR(totalOut));
  setText('kpi-txcount',  txData.length);
  setText('kpi-net',      (net >= 0 ? '+' : '') + formatINR(net));

  setDelta('kpi-received-delta', inChange,  `+${inChange}% vs prev period`,  `${inChange}% vs prev period`);
  setDelta('kpi-sent-delta',     -outChange, `-${outChange}% vs prev period`, `+${outChange}% vs prev period`);
  setDelta('kpi-txcount-delta',  txData.length > 0 ? 1 : 0, `${txData.length} total in period`, `0 this period`);

  // Net KPI delta
  const netEl = document.getElementById('kpi-net-delta');
  netEl.textContent = net >= 0 ? '📈 More in than out' : '📉 More out than in';
  netEl.className = `kpi-delta ${net >= 0 ? 'up' : 'down'}`;

  // Pending splits
  const pendTotal = splits.reduce((s, sp) => s + Number(sp.amount || 0), 0);
  setText('kpi-pending', splits.length);
  const pdEl = document.getElementById('kpi-pending-amt');
  pdEl.textContent = splits.length > 0 ? `${formatINR(pendTotal)} owed` : 'All settled ✓';
  pdEl.className   = `kpi-delta ${splits.length > 0 ? 'down' : 'up'}`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setDelta(id, positive, upLabel, downLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = positive >= 0 ? upLabel : downLabel;
  el.className   = `kpi-delta ${positive >= 0 ? 'up' : 'down'}`;
}

// ── Volume Chart (line) ──────────────────────────────────────
function renderVolumeChart(txData) {
  const labels = buildDayLabels(currentRange);
  const sentMap = {}, recvMap = {};
  labels.forEach(d => { sentMap[d] = 0; recvMap[d] = 0; });

  txData.forEach(tx => {
    const day = tx.created_at.slice(0, 10);
    if (recvMap.hasOwnProperty(day)) {
      if (tx.receiver_id === currentProfile.id) recvMap[day] += Number(tx.total_amount || 0);
      else                                      sentMap[day] += Number(tx.split_amount || tx.total_amount || 0);
    }
  });

  const sentVals = labels.map(d => sentMap[d] || 0);
  const recvVals = labels.map(d => recvMap[d] || 0);

  const empty = sentVals.every(v => v === 0) && recvVals.every(v => v === 0);
  toggleEmpty('empty-volume', empty);

  const fmtLabel = labels.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  });

  const cfg = {
    type: 'line',
    data: {
      labels: fmtLabel,
      datasets: [
        {
          label: 'Received',
          data: recvVals,
          borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)',
          fill: true, tension: 0.45, pointRadius: 4,
          pointBackgroundColor: '#34d399', pointBorderColor: '#0a0f1e', pointBorderWidth: 2,
          borderWidth: 2.5
        },
        {
          label: 'Sent',
          data: sentVals,
          borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)',
          fill: true, tension: 0.45, pointRadius: 4,
          pointBackgroundColor: '#f87171', pointBorderColor: '#0a0f1e', pointBorderWidth: 2,
          borderWidth: 2.5
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 16, font: { size: 11 } } },
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatINR(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { font: { size: 10 }, callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v) }
        }
      }
    }
  };

  if (chartVolume) chartVolume.destroy();
  chartVolume = new Chart(document.getElementById('chart-volume'), cfg);
}

// ── Payment Methods Donut ─────────────────────────────────────
function renderMethodsChart(txData) {
  const sent = txData.filter(tx => tx.initiated_by === currentProfile.id);
  const byMethod = {};
  sent.forEach(tx => {
    const m = tx.payment_method || 'unknown';
    byMethod[m] = (byMethod[m] || 0) + 1;
  });

  const labels = Object.keys(byMethod);
  const values = Object.values(byMethod);
  const total  = values.reduce((a,b) => a + b, 0);

  const colors = ['#a78bfa', '#34d399', '#f87171', '#fbbf24', '#60a5fa'];
  const empty  = total === 0;
  toggleEmpty('empty-methods', empty);

  const legendEl = document.getElementById('methods-legend');
  if (empty) { legendEl.innerHTML = ''; return; }

  const cfg = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#0a0f1e', borderWidth: 3,
        hoverBorderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${(ctx.raw/total*100).toFixed(0)}%)` }
        }
      }
    }
  };

  if (chartMethods) chartMethods.destroy();
  chartMethods = new Chart(document.getElementById('chart-methods'), cfg);

  legendEl.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]};"></div>
      <div class="legend-label">${l === 'phone' ? '📱 Phone' : l === 'qr' ? '📷 QR Scan' : l}</div>
      <div class="legend-pct">${(values[i]/total*100).toFixed(0)}%</div>
    </div>
  `).join('');
}

// ── Cumulative Cash Flow ──────────────────────────────────────
function renderCumulativeChart(txData) {
  const labels = buildDayLabels(currentRange);
  const netMap  = {};
  labels.forEach(d => { netMap[d] = 0; });

  txData.forEach(tx => {
    const day = tx.created_at.slice(0, 10);
    if (!netMap.hasOwnProperty(day)) return;
    if (tx.receiver_id === currentProfile.id) netMap[day] += Number(tx.total_amount || 0);
    else                                      netMap[day] -= Number(tx.split_amount || tx.total_amount || 0);
  });

  let running = 0;
  const cumulativeVals = labels.map(d => { running += netMap[d]; return running; });

  const empty = cumulativeVals.every(v => v === 0);
  toggleEmpty('empty-cumulative', empty);

  const fmtLabel = labels.map(d => new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));

  const positiveColor = 'rgba(52,211,153,0.15)';
  const negativeColor = 'rgba(248,113,113,0.15)';
  const lineColor     = cumulativeVals[cumulativeVals.length - 1] >= 0 ? '#34d399' : '#f87171';

  const cfg = {
    type: 'line',
    data: {
      labels: fmtLabel,
      datasets: [{
        label: 'Net Balance',
        data: cumulativeVals,
        borderColor: lineColor,
        backgroundColor: ctx => {
          const chart = ctx.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return positiveColor;
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, lineColor === '#34d399' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)');
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          return gradient;
        },
        fill: true, tension: 0.4, pointRadius: 3,
        pointBackgroundColor: lineColor, borderWidth: 2.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ` Net: ${formatINR(ctx.raw)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { font: { size: 10 }, callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v) }
        }
      }
    }
  };

  if (chartCumulative) chartCumulative.destroy();
  chartCumulative = new Chart(document.getElementById('chart-cumulative'), cfg);
}

// ── Hourly Pattern Bar Chart ──────────────────────────────────
function renderHourlyChart(txData) {
  const hourCounts = Array(24).fill(0);
  txData.forEach(tx => {
    const h = new Date(tx.created_at).getHours();
    hourCounts[h]++;
  });

  const empty = hourCounts.every(v => v === 0);
  toggleEmpty('empty-hourly', empty);

  const colors = hourCounts.map(v => {
    if (v === 0)   return 'rgba(255,255,255,0.06)';
    const max = Math.max(...hourCounts);
    const pct = v / max;
    if (pct < 0.33) return 'rgba(124,58,237,0.45)';
    if (pct < 0.66) return 'rgba(124,58,237,0.7)';
    return 'rgba(167,139,250,0.95)';
  });

  const cfg = {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i}h`),
      datasets: [{
        data: hourCounts,
        backgroundColor: colors,
        borderColor: 'transparent',
        borderRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.raw} transaction${ctx.raw !== 1 ? 's' : ''}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { stepSize: 1, font: { size: 10 } } }
      }
    }
  };

  if (chartHourly) chartHourly.destroy();
  chartHourly = new Chart(document.getElementById('chart-hourly'), cfg);
}

// ── Activity Heatmap ──────────────────────────────────────────
function renderHeatmap(txData) {
  const DAYS = 28;
  const dayCounts = {};

  for (let i = 0; i < DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayCounts[d.toISOString().slice(0, 10)] = 0;
  }

  txData.forEach(tx => {
    const day = tx.created_at.slice(0, 10);
    if (dayCounts.hasOwnProperty(day)) dayCounts[day]++;
  });

  const entries = Object.entries(dayCounts).reverse();
  const values  = Object.values(dayCounts);
  const max     = Math.max(...values, 1);

  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = entries.map(([day, cnt]) => {
    const pct = cnt / max;
    const level = pct === 0 ? 'l0' : pct < 0.25 ? 'l1' : pct < 0.5 ? 'l2' : pct < 0.75 ? 'l3' : 'l4';
    const label = new Date(day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return `<div class="hmap-day ${level}" title="${label}: ${cnt} transaction${cnt !== 1 ? 's' : ''}"></div>`;
  }).join('');
}

// ── Live Activity Feed ────────────────────────────────────────
function renderActivityFeed(txData) {
  const feed    = document.getElementById('activity-feed');
  const recent  = [...txData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);

  if (!recent.length) {
    feed.innerHTML = `<div class="empty-state" style="padding:2rem 0;">
      <div class="empty-icon">⚡</div><p>No transactions in this period.</p>
    </div>`;
    return;
  }

  feed.innerHTML = recent.map(tx => {
    const isReceiver = tx.receiver_id === currentProfile.id;
    const isSender   = tx.initiated_by === currentProfile.id;
    const amount     = isReceiver ? Number(tx.total_amount) : Number(tx.split_amount || tx.total_amount);
    const method     = tx.payment_method === 'phone' ? '📱' : '📷';
    const iconClass  = isReceiver ? 'receive' : 'send';
    const icon       = isReceiver ? '↓' : '↑';
    const who        = isReceiver
      ? (tx.profiles?.full_name || 'Someone')
      : (tx.receiver?.full_name || tx.receiver_phone || 'Recipient');

    return `
      <div class="activity-item">
        <div class="activity-icon ${iconClass}">${icon}</div>
        <div class="activity-body">
          <div class="activity-title">${isReceiver ? 'From ' : 'To '} ${who}</div>
          <div class="activity-time">${method} ${tx.payment_method} &middot; ${timeAgo(tx.created_at)} &middot; <span class="badge ${tx.status === 'completed' ? 'badge-accent' : 'badge-warning'}" style="font-size:0.6rem; padding:0.1rem 0.35rem;">${tx.status}</span></div>
        </div>
        <div class="activity-amount ${isReceiver ? 'pos' : 'neg'}">${isReceiver ? '+' : '-'}${formatINR(amount)}</div>
      </div>
    `;
  }).join('');
}

// ── Realtime Subscription ─────────────────────────────────────
function subscribeRealtime() {
  if (realtimeSub) supabaseClient.removeChannel(realtimeSub);

  realtimeSub = supabaseClient
    .channel('analytics-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'transactions',
      filter: `initiated_by=eq.${currentProfile.id}`
    }, handleRealtimeEvent)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'transactions',
      filter: `receiver_id=eq.${currentProfile.id}`
    }, handleRealtimeEvent)
    .subscribe();
}

let debounceTimer = null;
function handleRealtimeEvent(payload) {
  // Debounce rapid-fire events
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    showToast('📊 New activity detected — refreshing analytics…', 'info');
    await refreshAll();

    // Flash the activity feed
    const feed = document.getElementById('activity-feed');
    feed.style.transition = 'background 0.4s';
    feed.style.background = 'rgba(16,185,129,0.06)';
    setTimeout(() => { feed.style.background = ''; }, 800);
  }, 500);
}

// ── Helpers ───────────────────────────────────────────────────
function buildDayLabels(days) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function toggleEmpty(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'flex' : 'none';
}

function updateTimestamp() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

// ── Global Exposure ───────────────────────────────────────────
window.setRange    = setRange;
window.refreshAll  = refreshAll;
