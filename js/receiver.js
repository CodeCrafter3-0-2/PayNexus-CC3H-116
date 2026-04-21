// ============================================================
// PayNexus — Receiver Profile Logic
// ============================================================

let currentProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) return;

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut(); window.location.href = 'login.html';
  });

  renderProfile();
  generateQR();
  await loadReceivedPayments();
});

function renderProfile() {
  const p = currentProfile;
  document.getElementById('nav-avatar').textContent = getInitials(p.full_name);
  document.getElementById('profile-avatar').textContent = getInitials(p.full_name);
  document.getElementById('profile-name').textContent = p.full_name || 'User';
  document.getElementById('profile-email').textContent = p.email;
  document.getElementById('wallet-display').textContent = formatINR(p.wallet_balance);
  document.getElementById('detail-phone').textContent = p.phone || 'Not set';
  document.getElementById('detail-uid').textContent = p.id;
  document.getElementById('qr-code-text').textContent = p.qr_code || p.id;
}

function generateQR() {
  const qrData = currentProfile.qr_code || currentProfile.id;
  new QRCode(document.getElementById('qr-canvas'), {
    text: qrData,
    width: 180,
    height: 180,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

async function loadReceivedPayments() {
  const { data } = await supabaseClient
    .from('transactions')
    .select(`
      *,
      initiated_by_profile:profiles!transactions_initiated_by_fkey(full_name),
      groups(name)
    `)
    .eq('receiver_id', currentProfile.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const container = document.getElementById('received-payments');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><p>No payments received yet.</p></div>';
    return;
  }

  container.innerHTML = data.map(tx => `
    <div class="list-item" style="margin-bottom:.6rem;">
      <div class="list-item-left">
        <div class="list-avatar" style="background:linear-gradient(135deg,var(--accent),#059669);">↓</div>
        <div>
          <div class="list-name">From ${tx.initiated_by_profile?.full_name || 'Sender'}</div>
          <div class="list-sub">${tx.groups?.name ? tx.groups.name + ' · ' : ''}${tx.payment_method === 'phone' ? '📱' : '📷'} ${tx.payment_method} · ${timeAgo(tx.created_at)}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:800;color:var(--accent-light);">+${formatINR(tx.total_amount)}</div>
        <span class="badge ${tx.status === 'completed' ? 'badge-accent' : tx.status === 'failed' ? 'badge-danger' : 'badge-warning'}" style="margin-top:.25rem;">${tx.status}</span>
      </div>
    </div>
  `).join('');
}

function copyQR() {
  const text = document.getElementById('qr-code-text').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('QR code copied! 📋', 'success'));
}
function copyPhone() {
  const text = document.getElementById('detail-phone').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Phone number copied! 📋', 'success'));
}
function copyUID() {
  const text = document.getElementById('detail-uid').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('User ID copied! 📋', 'success'));
}

window.copyQR = copyQR;
window.copyPhone = copyPhone;
window.copyUID = copyUID;
