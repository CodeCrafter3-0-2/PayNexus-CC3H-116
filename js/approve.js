// ============================================================
// PayNexus — Approve Logic (with wallet deduction + credit)
// ============================================================

let currentProfile = null;
let currentTab = 'pending';
let pendingApprovalParams = null;
let pendingApprovalBtn = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) return;

  document.getElementById('nav-avatar').textContent = getInitials(currentProfile.full_name);



  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut(); window.location.href = 'login.html';
  });

  await loadPendingSplits();

  // PIN Modal Event Listeners
  document.getElementById('btn-cancel-pin').addEventListener('click', () => {
    document.getElementById('pin-modal').classList.remove('open');
    document.getElementById('approve-pin-input').value = '';
    const errorEl = document.getElementById('pin-error');
    errorEl.textContent = '';
    errorEl.classList.remove('show');
    if (pendingApprovalBtn) {
      pendingApprovalBtn.innerHTML = pendingApprovalBtn.dataset.originalText;
      pendingApprovalBtn.disabled = false;
    }
  });

  document.getElementById('btn-submit-pin').addEventListener('click', async () => {
    const pinInput = document.getElementById('approve-pin-input').value;
    const errorEl = document.getElementById('pin-error');
    
    if (pinInput.length !== 6) {
      errorEl.textContent = 'Please enter a 6-digit PIN.';
      errorEl.classList.add('show');
      return;
    }
    
    // Check if the PIN matches the one in the user's profile
    if (currentProfile.transaction_pin && currentProfile.transaction_pin !== pinInput) {
      errorEl.textContent = 'Incorrect PIN. Please try again.';
      errorEl.classList.add('show');
      return;
    } else if (!currentProfile.transaction_pin) {
      // In case they signed up before PIN was added or metadata didn't sync
      errorEl.textContent = 'No PIN found for this account. Please recreate your account.';
      errorEl.classList.add('show');
      return;
    }
    
    // PIN is correct, close modal and execute approval
    errorEl.textContent = '';
    errorEl.classList.remove('show');
    document.getElementById('pin-modal').classList.remove('open');
    document.getElementById('approve-pin-input').value = '';
    
    if (pendingApprovalParams) {
      await executeApproveSplit(pendingApprovalParams.splitId, pendingApprovalParams.transactionId, pendingApprovalParams.amount);
    }
  });
});

function switchTab(tab) {
  currentTab = tab;
  ['pending', 'approved', 'all'].forEach(t => {
    document.getElementById(`tab-${t}-content`).style.display = t === tab ? 'block' : 'none';
    document.getElementById(`tab-${t === 'all' ? 'all-tx' : t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'pending') loadPendingSplits();
  else if (tab === 'approved') loadApprovedSplits();
  else loadAllTransactions();
}

async function loadPendingSplits() {
  const container = document.getElementById('pending-list');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Loading...</p></div>';

  const { data } = await supabaseClient
    .from('transaction_splits')
    .select(`
      *,
      transactions(
        id, total_amount, split_amount, status, payment_flow, payment_method, created_at, description,
        receiver_phone, receiver_qr,
        initiated_by_profile:profiles!transactions_initiated_by_fkey(full_name, email),
        receiver:profiles!transactions_receiver_id_fkey(full_name, phone),
        groups(name)
      )
    `)
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending')
    .order('id', { ascending: false });

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>No pending approvals! You\'re all caught up.</p></div>';
    return;
  }

  // For each split, also load all other splits of the same transaction
  const txIds = [...new Set(data.map(s => s.transaction_id))];
  const { data: allSplits } = await supabaseClient
    .from('transaction_splits')
    .select(`*, profiles(full_name)`)
    .in('transaction_id', txIds);

  container.innerHTML = data.map(s => {
    const tx = s.transactions;
    const myAmount = s.amount;
    const others = (allSplits || []).filter(sp => sp.transaction_id === s.transaction_id);
    const approvedCount = others.filter(sp => sp.status === 'approved').length;
    const totalCount = others.length;

    return `
      <div class="approve-card fade-in" id="split-card-${s.id}">
        <div class="approve-card-header">
          <div>
            <div style="font-size:.78rem;color:var(--text-400);margin-bottom:.25rem;">
              💸 From ${tx?.initiated_by_profile?.full_name || 'Unknown'} · ${tx?.groups?.name || 'Direct'}
            </div>
            <div class="approve-amount" style="background:linear-gradient(90deg,var(--warning),#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
              ${formatINR(myAmount)}
            </div>
            <div style="font-size:.78rem;color:var(--text-400);margin-top:.2rem;">Your share of ${formatINR(tx?.total_amount || 0)} total</div>
          </div>
          <div style="text-align:right;">
            <span class="badge badge-warning">Pending</span>
            <div style="font-size:.75rem;color:var(--text-400);margin-top:.4rem;">${timeAgo(tx?.created_at)}</div>
          </div>
        </div>

        <div class="approve-card-body">
          <div class="split-info">
            <div class="split-info-item">
              <div class="split-info-label">Receiver</div>
              <div class="split-info-value">${tx?.receiver?.full_name || 'N/A'}</div>
            </div>
            <div class="split-info-item">
              <div class="split-info-label">Method</div>
              <div class="split-info-value">${tx?.payment_method === 'phone' ? '📱 Phone' : '📷 QR'}</div>
            </div>
            <div class="split-info-item">
              <div class="split-info-label">Total Bill</div>
              <div class="split-info-value">${formatINR(tx?.total_amount)}</div>
            </div>
            <div class="split-info-item">
              <div class="split-info-label">Your Balance</div>
              <div class="split-info-value" style="color:${currentProfile.wallet_balance >= myAmount ? 'var(--accent-light)' : 'var(--danger-light)'}">
                ${formatINR(currentProfile.wallet_balance)}
              </div>
            </div>
          </div>

          ${tx?.description ? `<div style="font-size:.82rem;color:var(--text-400);margin-bottom:.75rem;">📝 ${tx.description}</div>` : ''}

          <!-- Progress: how many approved -->
          <div style="margin-bottom:.75rem;">
            <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--text-400);margin-bottom:.35rem;">
              <span>Approval Progress</span><span>${approvedCount}/${totalCount} approved</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${(approvedCount/totalCount)*100}%"></div></div>
          </div>

          <!-- Member Splits -->
          <div class="members-split" style="margin-bottom:1rem;">
            ${others.map(sp => `
              <div class="list-item" style="padding:.6rem .8rem;">
                <div class="list-item-left">
                  <div class="list-avatar" style="width:32px;height:32px;font-size:.75rem;">${getInitials(sp.profiles?.full_name)}</div>
                  <div class="list-name" style="font-size:.85rem;">${sp.profiles?.full_name}${sp.user_id === currentProfile.id ? ' (You)' : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:.5rem;">
                  <span style="font-weight:700;font-size:.85rem;">${formatINR(sp.amount)}</span>
                  <span class="badge ${sp.status === 'approved' ? 'badge-accent' : sp.status === 'rejected' ? 'badge-danger' : 'badge-warning'}" style="font-size:.7rem;">${sp.status}</span>
                </div>
              </div>
            `).join('')}
          </div>

          ${currentProfile.wallet_balance < myAmount
            ? `<div style="font-size:.82rem;color:var(--danger-light);background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:.6rem .9rem;margin-bottom:.75rem;">⚠️ Insufficient balance. Need ${formatINR(myAmount - currentProfile.wallet_balance)} more.</div>`
            : ''}

          <div class="approve-actions">
            <button class="btn btn-accent" onclick="approveSplit('${s.id}', '${s.transaction_id}', ${myAmount})" 
              ${currentProfile.wallet_balance < myAmount ? 'disabled title="Insufficient balance"' : ''}>
              ✅ ${tx.payment_flow === 'pay_first' ? `Reimburse Sender` : `Approve Split`} ${formatINR(myAmount)}
            </button>
            <button class="btn btn-danger" onclick="rejectSplit('${s.id}', '${s.transaction_id}')">
              ✗ Reject
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function approveSplit(splitId, transactionId, amount) {
  const btn = event.target;
  // Save original text to restore if cancelled
  if (!btn.dataset.originalText) {
    btn.dataset.originalText = btn.innerHTML;
  }
  btn.innerHTML = '<span class="spinner"></span>'; 
  btn.disabled = true;

  // Store params and button reference
  pendingApprovalParams = { splitId, transactionId, amount };
  pendingApprovalBtn = btn;

  // Show PIN modal
  document.getElementById('pin-modal').classList.add('open');
  document.getElementById('approve-pin-input').focus();
}

async function executeApproveSplit(splitId, transactionId, amount) {
  const btn = pendingApprovalBtn;

  // 1. Call Secure RPC to handle EVERYTHING
  const { error } = await supabaseClient.rpc('approve_split', { split_id: splitId });

  if (error) { 
    showToast('Failed to approve: ' + error.message, 'error'); 
    btn.innerHTML = '✅ Approve'; 
    btn.disabled = false; 
    return; 
  }

  // Deduct locally for fast UI update
  currentProfile.wallet_balance -= amount;

  // Fetch updated TX to check if completed and email people
  const { data: tx } = await supabaseClient
    .from('transactions')
    .select('*, initiated_by_profile:profiles!transactions_initiated_by_fkey(email, full_name), receiver:profiles!transactions_receiver_id_fkey(email)')
    .eq('id', transactionId)
    .single();

  if (tx.payment_flow === 'pay_first') {
    showToast(`✅ Approved! ${formatINR(amount)} sent to ${tx.initiated_by_profile?.full_name} to clear debt.`, 'success');
    if (tx.initiated_by_profile && tx.initiated_by_profile.email) {
       sendPaymentEmail(tx.initiated_by_profile.email, "Debt Reimbursed - PayNexus", `<h2>Debt Repaid</h2><p>Someone just repaid their debt split of <b>${formatINR(amount)}</b> via PayNexus.</p>`);
    }
  } else {
    showToast(`✅ Approved! ${formatINR(amount)} deducted from your wallet.`, 'success');
  }

  if (currentProfile && currentProfile.email) {
    sendPaymentEmail(currentProfile.email, "Payment Approved - PayNexus", `<h2>Payment Approved</h2><p>You paid <b>${formatINR(amount)}</b> from your PayNexus wallet.</p>`);
  }

  if (tx.status === 'completed' && tx.payment_flow !== 'pay_first') {
     showToast(`🎉 All members approved! ${formatINR(tx.total_amount)} credited to receiver.`, 'success');
     if (tx.receiver && tx.receiver.email) {
         sendPaymentEmail(tx.receiver.email, "Payment Received - PayNexus", `<h2>Payment Received! 🎉</h2><p>You just received <b>${formatINR(tx.total_amount)}</b> in your PayNexus wallet.</p>`);
     }
  }

  // Reload
  await loadPendingSplits();
}

async function rejectSplit(splitId, transactionId) {
  const { error } = await supabaseClient
    .from('transaction_splits')
    .update({ status: 'rejected' })
    .eq('id', splitId);

  if (error) { showToast('Failed to reject.', 'error'); return; }

  // Mark transaction as failed
  await supabaseClient.from('transactions').update({ status: 'failed' }).eq('id', transactionId);

  showToast('Payment rejected.', 'info');
  await loadPendingSplits();
}

async function loadApprovedSplits() {
  const container = document.getElementById('approved-list');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Loading...</p></div>';

  const { data } = await supabaseClient
    .from('transaction_splits')
    .select(`*, transactions(total_amount, split_amount, status, payment_method, created_at, groups(name), initiated_by_profile:profiles!transactions_initiated_by_fkey(full_name))`)
    .eq('user_id', currentProfile.id)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false });

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No approved payments yet.</p></div>';
    return;
  }

  container.innerHTML = data.map(s => `
    <div class="list-item" style="margin-bottom:.6rem;background:rgba(16,185,129,0.05);border-color:rgba(16,185,129,0.15);">
      <div class="list-item-left">
        <div class="list-avatar" style="background:linear-gradient(135deg,var(--accent),#059669);">✓</div>
        <div>
          <div class="list-name">${formatINR(s.amount)} approved</div>
          <div class="list-sub">${s.transactions?.groups?.name || 'Direct'} · From ${s.transactions?.initiated_by_profile?.full_name} · ${timeAgo(s.approved_at)}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;color:var(--danger-light);">-${formatINR(s.amount)}</div>
        <span class="badge badge-accent" style="margin-top:.25rem;">${s.transactions?.status}</span>
      </div>
    </div>
  `).join('');
}

async function loadAllTransactions() {
  const container = document.getElementById('all-tx-list');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Loading...</p></div>';

  const { data } = await supabaseClient
    .from('transactions')
    .select(`
      *,
      initiated_by_profile:profiles!transactions_initiated_by_fkey(full_name),
      receiver:profiles!transactions_receiver_id_fkey(full_name, phone),
      groups(name)
    `)
    .or(`initiated_by.eq.${currentProfile.id},receiver_id.eq.${currentProfile.id}`)
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><p>No transactions found.</p></div>';
    return;
  }

  container.innerHTML = data.map(tx => {
    const isSender = tx.initiated_by === currentProfile.id;
    const isReceiver = tx.receiver_id === currentProfile.id;
    return `
      <div class="list-item" style="margin-bottom:.6rem;">
        <div class="list-item-left">
          <div class="list-avatar" style="background:${isSender ? 'linear-gradient(135deg,var(--danger),#dc2626)' : 'linear-gradient(135deg,var(--accent),#059669)'}">
            ${isSender ? '↑' : '↓'}
          </div>
          <div>
            <div class="list-name">
              ${isSender ? `To ${tx.receiver?.full_name || tx.receiver_phone}` : `From ${tx.initiated_by_profile?.full_name}`}
              ${tx.groups ? `· <span style="color:var(--primary-light);">${tx.groups.name}</span>` : ''}
            </div>
            <div class="list-sub">${tx.payment_method === 'phone' ? '📱' : '📷'} ${tx.payment_method} · Total ${formatINR(tx.total_amount)} · ${timeAgo(tx.created_at)}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;color:${isReceiver ? 'var(--accent-light)' : 'var(--danger-light)'};">
            ${isReceiver ? '+' : '-'}${formatINR(isReceiver ? tx.total_amount : tx.split_amount)}
          </div>
          <span class="badge ${tx.status === 'completed' ? 'badge-accent' : tx.status === 'failed' ? 'badge-danger' : 'badge-warning'}" style="margin-top:.25rem;">${tx.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

window.switchTab = switchTab;
window.approveSplit = approveSplit;
window.rejectSplit = rejectSplit;
