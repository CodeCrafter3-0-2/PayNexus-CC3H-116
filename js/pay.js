// ============================================================
// PayNexus — Pay Logic
// ============================================================

let currentProfile = null;
let selectedMethod = 'phone';
let receiverProfile = null;
let groupMembers = [];
let selectedGroupId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) return;



  document.getElementById('nav-avatar').textContent = getInitials(currentProfile.full_name);
  document.getElementById('wallet-balance-display').textContent = formatINR(currentProfile.wallet_balance);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut(); window.location.href = 'login.html';
  });

  document.getElementById('group-select').addEventListener('change', onGroupChange);

  await loadGroups();

  // Pre-select group from URL param
  const params = new URLSearchParams(window.location.search);
  const preGroup = params.get('group');
  if (preGroup) {
    document.getElementById('group-select').value = preGroup;
    await onGroupChange();
  }
});

async function loadGroups() {
  const { data: memberships } = await supabaseClient
    .from('group_members')
    .select('group_id')
    .eq('user_id', currentProfile.id)
    .eq('status', 'accepted');

  const groupIds = (memberships || []).map(m => m.group_id);
  if (groupIds.length === 0) return;

  const { data: groups } = await supabaseClient
    .from('groups')
    .select('*')
    .in('id', groupIds);

  const select = document.getElementById('group-select');
  (groups || []).forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id; opt.textContent = g.name;
    select.appendChild(opt);
  });
}

async function onGroupChange() {
  selectedGroupId = document.getElementById('group-select').value;
  if (!selectedGroupId) { groupMembers = []; updateSplitPreview(); return; }

  const { data: members } = await supabaseClient
    .from('group_members')
    .select(`*, profiles(id, full_name, email, wallet_balance)`)
    .eq('group_id', selectedGroupId)
    .eq('status', 'accepted');

  groupMembers = members || [];

  // Render group members panel
  const panel = document.getElementById('group-members-panel');
  panel.innerHTML = `
    <div style="font-weight:700;font-size:.85rem;color:var(--text-400);margin-bottom:.75rem;">GROUP MEMBERS (${groupMembers.length})</div>
    ${groupMembers.map(m => `
      <div class="list-item" style="margin-bottom:.4rem;">
        <div class="list-item-left">
          <div class="list-avatar">${getInitials(m.profiles?.full_name)}</div>
          <div>
            <div class="list-name">${m.profiles?.full_name} ${m.user_id === currentProfile.id ? '(You)' : ''}</div>
            <div class="list-sub">${formatINR(m.profiles?.wallet_balance)} balance</div>
          </div>
        </div>
      </div>
    `).join('')}
  `;

  updateSplitPreview();
}

let html5QrCode = null;

function selectMethod(method) {
  selectedMethod = method;
  document.getElementById('method-phone').classList.toggle('active', method === 'phone');
  document.getElementById('method-qr').classList.toggle('active', method === 'qr');
  document.getElementById('phone-input-section').style.display = method === 'phone' ? 'flex' : 'none';
  document.getElementById('qr-input-section').style.display = method === 'qr' ? 'block' : 'none';
  
  // Stop scanner if switching away
  if (method !== 'qr' && html5QrCode && html5QrCode.isScanning) {
    stopScanner();
  }

  receiverProfile = null;
  document.getElementById('receiver-preview').classList.remove('show');
}

async function toggleScanner() {
  const btn = document.getElementById('btn-toggle-scanner');
  if (html5QrCode && html5QrCode.isScanning) {
    await stopScanner();
    btn.innerHTML = '<i data-lucide="camera" style="width:18px;height:18px;margin-right:8px;"></i> Start Camera Scanner';
    lucide.createIcons();
  } else {
    await startScanner();
    btn.innerHTML = '<i data-lucide="square" style="width:18px;height:18px;margin-right:8px;"></i> Stop Camera Scanner';
    lucide.createIcons();
  }
}

async function startScanner() {
  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader");
  }

  const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };

  try {
    document.getElementById('scan-status').textContent = 'Requesting camera permission...';
    await html5QrCode.start(
      { facingMode: "environment" }, 
      qrConfig,
      onScanSuccess
    );
    document.getElementById('scan-status').textContent = 'Scanner Active: Point at a PayNexus QR code';
  } catch (err) {
    console.error(err);
    document.getElementById('scan-status').textContent = 'Camera error: ' + err;
    showToast('Could not access camera. Please check permissions.', 'error');
  }
}

async function stopScanner() {
  if (html5QrCode && html5QrCode.isScanning) {
    await html5QrCode.stop();
    document.getElementById('scan-status').textContent = 'Scanner Stopped';
  }
}

function onScanSuccess(decodedText, decodedResult) {
  // Assuming the QR code contains the User ID / QR ID
  document.getElementById('receiver-qr-id').value = decodedText;
  stopScanner();
  
  const btn = document.getElementById('btn-toggle-scanner');
  btn.innerHTML = '<i data-lucide="camera" style="width:18px;height:18px;margin-right:8px;"></i> Start Camera Scanner';
  lucide.createIcons();
  
  lookupByQR();
}

let lookupTimeout;
function handlePhoneInput() {
  clearTimeout(lookupTimeout);
  const raw = document.getElementById('receiver-phone').value.trim();
  if (raw.length === 10) {
    lookupTimeout = setTimeout(() => {
      lookupReceiver();
    }, 500);
  } else {
    document.getElementById('receiver-preview').classList.remove('show');
    receiverProfile = null;
  }
}

async function lookupReceiver() {
  const code = document.getElementById('receiver-country-code').value;
  const raw = document.getElementById('receiver-phone').value.trim();
  const phone = code + raw;
  if (!raw) { showToast('Enter a phone number first.', 'error'); return; }

  // Create a visual feedback if button doesn't exist anymore
  const phoneContainer = document.getElementById('receiver-phone');
  phoneContainer.style.opacity = '0.5';

  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('phone', phone).maybeSingle();
  phoneContainer.style.opacity = '1';

  if (!profile) { showToast('No user found with this phone.', 'error'); return; }

  if (profile.id === currentProfile.id) { showToast("You can't pay yourself.", 'error'); return; }

  receiverProfile = profile;
  showReceiverPreview(profile);
}

async function lookupByQR() {
  const qrId = document.getElementById('receiver-qr-id').value.trim();
  if (!qrId) { showToast('Enter a user ID to simulate QR scan.', 'error'); return; }

  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('qr_code', qrId).maybeSingle();
  if (!profile) { showToast('Invalid QR code / User ID.', 'error'); return; }

  if (profile.id === currentProfile.id) { showToast("You can't pay yourself.", 'error'); return; }

  receiverProfile = profile;
  showReceiverPreview(profile);
  showToast('QR scanned successfully! ✅', 'success');
}

function showReceiverPreview(profile) {
  document.getElementById('recv-avatar').textContent = getInitials(profile.full_name);
  document.getElementById('recv-name').textContent = profile.full_name || 'Unknown';
  document.getElementById('recv-sub').textContent = `📱 ${profile.phone || 'N/A'}`;
  document.getElementById('receiver-preview').classList.add('show');
}

function updateSplitPreview() {
  const amount = parseFloat(document.getElementById('pay-amount').value) || 0;
  const preview = document.getElementById('split-preview');

  if (amount <= 0 || groupMembers.length === 0) { preview.classList.remove('show'); return; }

  const perPerson = amount / groupMembers.length;
  const rows = groupMembers.map(m => `
    <div class="split-row">
      <span>${m.profiles?.full_name}${m.user_id === currentProfile.id ? ' (You)' : ''}</span>
      <strong>${formatINR(perPerson)}</strong>
    </div>
  `).join('');

  document.getElementById('split-rows').innerHTML = `
    ${rows}
    <div class="split-row split-total">
      <strong>Total</strong>
      <strong style="color:var(--accent-light);">${formatINR(amount)}</strong>
    </div>
    <div style="font-size:.75rem;color:var(--text-400);margin-top:.5rem;">Each member will receive an approval request for ${formatINR(perPerson)}</div>
  `;
  preview.classList.add('show');
}

async function initiatePayment() {
  const errorEl = document.getElementById('pay-error');
  errorEl.classList.remove('show');

  if (!selectedGroupId) { errorEl.textContent = 'Please select a group.'; errorEl.classList.add('show'); return; }
  if (!receiverProfile) { errorEl.textContent = 'Please look up a receiver first.'; errorEl.classList.add('show'); return; }

  const amount = parseFloat(document.getElementById('pay-amount').value);
  if (!amount || amount <= 0) { errorEl.textContent = 'Please enter a valid amount.'; errorEl.classList.add('show'); return; }

  if (groupMembers.length === 0) { errorEl.textContent = 'Group has no accepted members.'; errorEl.classList.add('show'); return; }

  const flowType = document.getElementById('payment-flow').value;
  const splitAmount = amount / groupMembers.length;

  // Check if initiator can afford upfront payment
  if (flowType === 'pay_first' && currentProfile.wallet_balance < amount) {
    errorEl.textContent = `Insufficient balance to pay upfront. You need ${formatINR(amount)}.`; errorEl.classList.add('show'); return;
  }

  // Check wallet balances for group potential
  for (const m of groupMembers) {
    if (m.profiles.wallet_balance < splitAmount) {
      errorEl.textContent = `${m.profiles.full_name} has insufficient balance (${formatINR(m.profiles.wallet_balance)}).`; errorEl.classList.add('show'); return;
    }
  }

  const btn = document.getElementById('btn-pay');
  btn.innerHTML = '<span class="spinner"></span> Processing...'; btn.disabled = true;

  const desc = document.getElementById('pay-desc').value.trim();

  // Create transaction
  const { data: tx, error: txError } = await supabaseClient.from('transactions').insert({
    group_id: selectedGroupId,
    initiated_by: currentProfile.id,
    receiver_id: receiverProfile.id,
    total_amount: amount,
    split_amount: splitAmount,
    status: 'pending',
    payment_method: selectedMethod,
    payment_flow: flowType,
    receiver_phone: selectedMethod === 'phone' ? (document.getElementById('receiver-country-code').value + document.getElementById('receiver-phone').value.trim()) : null,
    receiver_qr: selectedMethod === 'qr' ? document.getElementById('receiver-qr-id').value.trim() : null,
    description: desc || null
  }).select().single();

  if (txError) {
    errorEl.textContent = txError.message; errorEl.classList.add('show');
    btn.innerHTML = '⚡ Initiate Split Payment'; btn.disabled = false; return;
  }

  // Create splits for each member
  const splits = groupMembers.map(m => ({
    transaction_id: tx.id,
    user_id: m.user_id,
    amount: splitAmount,
    status: 'pending'
  }));

  const { error: splitError } = await supabaseClient.from('transaction_splits').insert(splits);
  if (splitError) {
    errorEl.textContent = splitError.message; errorEl.classList.add('show');
    btn.innerHTML = '⚡ Initiate Split Payment'; btn.disabled = false; return;
  }

  if (flowType === 'pay_first') {
    const { error: rpcError } = await supabaseClient.rpc('pay_upfront', { tx_id: tx.id });
    if (rpcError) {
       errorEl.textContent = 'Failed upfront payment: ' + rpcError.message; errorEl.classList.add('show');
       btn.innerHTML = '⚡ Initiate Split Payment'; btn.disabled = false; return;
    }
  }

  if (currentProfile && currentProfile.email) {
    const title = flowType === 'pay_first' ? 'Payment Upfront Completed' : 'Payment Initiated';
    const body = flowType === 'pay_first' 
      ? `<h2>Payment Upfront Complete</h2><p>You have successfully paid the full amount of <b>${formatINR(amount)}</b> upfront. The group now owes you their splits.</p>`
      : `<h2>Payment Initiated</h2><p>You have successfully initiated a group split payment of <b>${formatINR(amount)}</b>.</p>`;
    sendPaymentEmail(currentProfile.email, `${title} - PayNexus`, body);
  }

  if (flowType === 'pay_first' && receiverProfile && receiverProfile.email) {
    sendPaymentEmail(receiverProfile.email, "Payment Received (Upfront) - PayNexus", `<h2>Payment Received! 🎉</h2><p><b>${currentProfile.full_name}</b> has paid you <b>${formatINR(amount)}</b> upfront via PayNexus. This amount has been credited to your wallet immediately.</p>`);
  }

  showToast(`Payment initiated! Each member owes ${formatINR(splitAmount)} ✅`, 'success');
  setTimeout(() => window.location.href = 'approve.html', 1200);
}

window.selectMethod = selectMethod;
window.handlePhoneInput = handlePhoneInput;
window.lookupReceiver = lookupReceiver;
window.lookupByQR = lookupByQR;
window.updateSplitPreview = updateSplitPreview;
window.initiatePayment = initiatePayment;
window.toggleScanner = toggleScanner;
