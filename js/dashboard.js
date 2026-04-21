// ============================================================
// PayNexus — Dashboard Logic
// ============================================================

let currentProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) { showToast('Failed to load profile.', 'error'); return; }

  renderNavUser();
  renderWallet();
  await loadStats();
  await loadPendingSplits();
  await loadGroupInvites();
  await loadRecentTransactions();

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });

  // Add shortcut button to view their profile (QR page)
  const dashApproveBtn = document.getElementById('dash-approve-btn');
  dashApproveBtn.insertAdjacentHTML('afterend', `<a href="receiver.html" class="btn btn-accent" style="margin-left:.5rem;">💳 My QR Code</a>`);
});

function renderNavUser() {
  document.getElementById('nav-avatar').textContent = getInitials(currentProfile.full_name);
}

function renderWallet() {
  document.getElementById('wallet-balance').textContent = Number(currentProfile.wallet_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const roleBadge = document.getElementById('user-role-badge');
  roleBadge.textContent = 'Active Account';
  roleBadge.className = `badge badge-primary`;
}

async function loadStats() {
  // Groups count
  const { count: grpCount } = await supabaseClient
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentProfile.id)
    .eq('status', 'accepted');
  document.getElementById('stat-groups').textContent = grpCount || 0;

  // Payments initiated
  const { count: txCount } = await supabaseClient
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('initiated_by', currentProfile.id);
  document.getElementById('stat-payments').textContent = txCount || 0;

  // Pending splits
  const { count: pendCount } = await supabaseClient
    .from('transaction_splits')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending');
  document.getElementById('stat-pending').textContent = pendCount || 0;

  if (pendCount > 0) {
    const badge = document.getElementById('pending-count-badge');
    badge.textContent = pendCount;
    badge.style.display = 'inline-flex';
  }

  // Invites
  const { count: invCount } = await supabaseClient
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending');
  document.getElementById('stat-invites').textContent = invCount || 0;
}

async function loadPendingSplits() {
  const { data } = await supabaseClient
    .from('transaction_splits')
    .select(`*, transactions(total_amount, split_amount, created_at, payment_method, receiver_phone)`)
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending')
    .order('id', { ascending: false })
    .limit(5);

  const container = document.getElementById('pending-splits-list');
  if (!data || data.length === 0) return;

  container.innerHTML = data.map(s => `
    <div class="list-item approval-item" style="margin-bottom:.5rem;">
      <div class="list-item-left">
        <div class="list-avatar" style="background:linear-gradient(135deg,var(--warning),#d97706);">₹</div>
        <div>
          <div class="list-name">${formatINR(s.amount)} split charge</div>
          <div class="list-sub">${s.transactions?.payment_method === 'phone' ? '📱 Phone payment' : '📷 QR payment'} · ${timeAgo(s.transactions?.created_at)}</div>
        </div>
      </div>
      <a href="approve.html" class="btn btn-sm btn-accent">Approve</a>
    </div>
  `).join('');
}

async function loadGroupInvites() {
  const { data } = await supabaseClient
    .from('group_members')
    .select(`*, groups(name, created_by, profiles!groups_created_by_fkey(full_name))`)
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending')
    .limit(5);

  const container = document.getElementById('invites-list');
  if (!data || data.length === 0) return;

  container.innerHTML = data.map(inv => `
    <div class="list-item" style="margin-bottom:.5rem;">
      <div class="list-item-left">
        <div class="list-avatar">👥</div>
        <div>
          <div class="list-name">${inv.groups?.name || 'Group Invite'}</div>
          <div class="list-sub">From ${inv.groups?.profiles?.full_name || 'Unknown'}</div>
        </div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button class="btn btn-sm btn-accent" onclick="respondInvite('${inv.id}','accepted')">✓</button>
        <button class="btn btn-sm btn-danger" onclick="respondInvite('${inv.id}','rejected')">✗</button>
      </div>
    </div>
  `).join('');
}

async function respondInvite(memberId, status) {
  const { error } = await supabaseClient
    .from('group_members')
    .update({ status, joined_at: status === 'accepted' ? new Date().toISOString() : null })
    .eq('id', memberId);

  if (error) { showToast('Failed to respond.', 'error'); return; }
  showToast(status === 'accepted' ? 'Joined the group! 🎉' : 'Invite declined.', status === 'accepted' ? 'success' : 'info');
  await loadGroupInvites();
  await loadStats();
}

async function loadRecentTransactions() {
  const { data } = await supabaseClient
    .from('transactions')
    .select(`*, profiles!transactions_initiated_by_fkey(full_name), receiver:profiles!transactions_receiver_id_fkey(full_name)`)
    .or(`initiated_by.eq.${currentProfile.id},receiver_id.eq.${currentProfile.id}`)
    .order('created_at', { ascending: false })
    .limit(10);

  const container = document.getElementById('recent-tx-list');
  if (!data || data.length === 0) return;

  container.innerHTML = data.map(tx => {
    const isSender = tx.initiated_by === currentProfile.id;
    const isReceiver = tx.receiver_id === currentProfile.id;
    const amountClass = isReceiver ? 'tx-amount-pos' : 'tx-amount-neg';
    const amountSign = isReceiver ? '+' : '-';
    const statusBadge = tx.status === 'completed' ? 'badge-accent' : tx.status === 'failed' ? 'badge-danger' : 'badge-warning';
    return `
      <div class="list-item" style="margin-bottom:.5rem;">
        <div class="list-item-left">
          <div class="list-avatar" style="background:${isSender ? 'linear-gradient(135deg,var(--danger),#dc2626)' : 'linear-gradient(135deg,var(--accent),#059669)'};">
            ${isSender ? '↑' : '↓'}
          </div>
          <div>
            <div class="list-name">${isSender ? `To ${tx.receiver?.full_name || tx.receiver_phone}` : `From ${tx.profiles?.full_name || 'Sender'}`}</div>
            <div class="list-sub">${tx.payment_method === 'phone' ? '📱' : '📷'} ${tx.payment_method} · ${timeAgo(tx.created_at)}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="${amountClass}">${amountSign}${formatINR(isReceiver ? tx.total_amount : tx.split_amount)}</div>
          <span class="badge ${statusBadge}" style="margin-top:.25rem;">${tx.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// 📊 Statement Logic
// ============================================================

let stmtMode = '1d';

function setQuickRange(mode) {
  stmtMode = mode;
  document.getElementById('btn-quick-1d').classList.toggle('active', mode === '1d');
  document.getElementById('btn-quick-range').classList.toggle('active', mode === 'custom');
  document.getElementById('custom-range-inputs').style.display = mode === 'custom' ? 'flex' : 'none';
}

async function generateStatement() {
  const btn = event.target;
  const container = document.getElementById('statement-results');
  const summary = document.getElementById('statement-summary');
  
  let start, end;

  if (stmtMode === '1d') {
    end = new Date();
    start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  } else {
    const sStr = document.getElementById('stmt-start').value;
    const eStr = document.getElementById('stmt-end').value;
    
    if (!sStr || !eStr) { showToast('Please select start and end dates', 'error'); return; }
    
    start = new Date(sStr);
    end = new Date(eStr);
    end.setHours(23, 59, 59, 999); // End of day

    if (start > end) { showToast('Start date cannot be after end date', 'error'); return; }

    // Validation: Max 1 month (31 days)
    const diffMs = end - start;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 31) {
       showToast('Statement range cannot exceed 31 days (1 month)', 'error');
       return;
    }
  }

  container.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Fetching records...</p></div>';
  summary.style.display = 'none';

  const { data, error } = await supabaseClient
    .from('transactions')
    .select(`*, profiles!transactions_initiated_by_fkey(full_name), receiver:profiles!transactions_receiver_id_fkey(full_name)`)
    .or(`initiated_by.eq.${currentProfile.id},receiver_id.eq.${currentProfile.id}`)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to fetch statement: ' + error.message, 'error'); return; }

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>No transactions found for this period.</p></div>';
    return;
  }

  let totalIn = 0;
  let totalOut = 0;

  container.innerHTML = data.map(tx => {
    const isSender = tx.initiated_by === currentProfile.id;
    const isReceiver = tx.receiver_id === currentProfile.id;
    const amount = isReceiver ? Number(tx.total_amount) : Number(tx.split_amount);
    
    if (isReceiver) totalIn += amount;
    else totalOut += amount;

    const amountClass = isReceiver ? 'tx-amount-pos' : 'tx-amount-neg';
    const amountSign = isReceiver ? '+' : '-';
    const statusBadge = tx.status === 'completed' ? 'badge-accent' : tx.status === 'failed' ? 'badge-danger' : 'badge-warning';
    
    return `
      <div class="list-item" style="margin-bottom:.5rem; background:rgba(255,255,255,0.02)">
        <div class="list-item-left">
          <div class="list-avatar" style="background:${isSender ? 'linear-gradient(135deg,var(--danger),#dc2626)' : 'linear-gradient(135deg,var(--accent),#059669)'}; width:32px; height:32px; font-size:0.7rem;">
             ${isSender ? '↑' : '↓'}
          </div>
          <div>
            <div class="list-name" style="font-size:0.85rem;">${isSender ? `To ${tx.receiver?.full_name || tx.receiver_phone}` : `From ${tx.profiles?.full_name || 'Sender'}`}</div>
            <div class="list-sub" style="font-size:0.7rem;">${new Date(tx.created_at).toLocaleDateString()} ${new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="${amountClass}" style="font-size:0.85rem;">${amountSign}${formatINR(amount)}</div>
          <span class="badge ${statusBadge}" style="font-size:0.6rem; padding:0.1rem 0.4rem;">${tx.status}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('stmt-total-in').textContent = formatINR(totalIn);
  document.getElementById('stmt-total-out').textContent = formatINR(totalOut);
  summary.style.display = 'block';
}

// Global exposure
window.setQuickRange = setQuickRange;
window.generateStatement = generateStatement;

