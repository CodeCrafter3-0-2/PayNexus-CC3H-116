// ============================================================
// PayNexus — Groups Logic
// ============================================================

let currentProfile = null;
let selectedGroupId = null;
let allGroups = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (!currentProfile) return;

  document.getElementById('nav-avatar').textContent = getInitials(currentProfile.full_name);

  document.getElementById('btn-create-group').style.display = 'inline-flex';
  document.getElementById('nav-pay').style.display = '';

  // Create group
  document.getElementById('btn-create-group').addEventListener('click', () => openModal('modal-create-group'));
  document.getElementById('form-create-group').addEventListener('submit', handleCreateGroup);
  document.getElementById('form-invite').addEventListener('submit', handleInvite);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut(); window.location.href = 'login.html';
  });

  await loadGroups();
  await loadInvites();
});

async function loadGroups() {
  // Groups I created OR am a member of (accepted)
  const { data: memberships } = await supabaseClient
    .from('group_members')
    .select('group_id, status')
    .eq('user_id', currentProfile.id)
    .eq('status', 'accepted');

  const memberGroupIds = (memberships || []).map(m => m.group_id);

  // Groups I created
  const { data: createdGroups } = await supabaseClient
    .from('groups')
    .select('*')
    .eq('created_by', currentProfile.id)
    .order('created_at', { ascending: false });

  // Groups I'm a member of (but didn't create)
  let memberGroups = [];
  if (memberGroupIds.length > 0) {
    const { data } = await supabaseClient
      .from('groups')
      .select('*')
      .in('id', memberGroupIds)
      .neq('created_by', currentProfile.id);
    memberGroups = data || [];
  }

  allGroups = [...(createdGroups || []), ...memberGroups];

  const container = document.getElementById('groups-container');
  if (allGroups.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No groups yet. Create one to get started!</p></div>';
    return;
  }

  container.innerHTML = allGroups.map(g => `
    <div class="group-card-item" id="grp-${g.id}" onclick="selectGroup('${g.id}')">
      <div style="display:flex;align-items:center;gap:.75rem;">
        <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--accent));display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">👥</div>
        <div>
          <div style="font-weight:700;font-size:.9rem;">${g.name}</div>
          <div style="font-size:.75rem;color:var(--text-400);">${g.created_by === currentProfile.id ? '👑 You created' : 'Member'} · ${timeAgo(g.created_at)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadInvites() {
  const { data } = await supabaseClient
    .from('group_members')
    .select(`*, groups(name, created_by), profiles!group_members_user_id_fkey(full_name)`)
    .eq('user_id', currentProfile.id)
    .eq('status', 'pending');

  const container = document.getElementById('invites-container');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No pending invites</p></div>';
    document.getElementById('invites-section').style.display = 'none';
    return;
  }

  document.getElementById('invites-section').style.display = 'block';
  container.innerHTML = data.map(inv => `
    <div class="list-item" style="margin-bottom:.5rem;">
      <div class="list-item-left">
        <div class="list-avatar">👥</div>
        <div>
          <div class="list-name">${inv.groups?.name}</div>
          <div class="list-sub">Invite to join group</div>
        </div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button class="btn btn-sm btn-accent" onclick="respondInvite('${inv.id}','accepted')">Accept</button>
        <button class="btn btn-sm btn-danger" onclick="respondInvite('${inv.id}','rejected')">Decline</button>
      </div>
    </div>
  `).join('');
}

async function respondInvite(memberId, status) {
  await supabaseClient.from('group_members').update({ status, joined_at: status === 'accepted' ? new Date().toISOString() : null }).eq('id', memberId);
  showToast(status === 'accepted' ? 'Joined group! 🎉' : 'Invite declined.', status === 'accepted' ? 'success' : 'info');
  await loadInvites();
  await loadGroups();
}

async function selectGroup(groupId) {
  selectedGroupId = groupId;
  document.querySelectorAll('.group-card-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`grp-${groupId}`);
  if (el) el.classList.add('selected');
  await renderGroupDetail(groupId);
}

async function renderGroupDetail(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  const panel = document.getElementById('group-detail-panel');
  panel.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Loading...</p></div>';

  // Get members
  const { data: members } = await supabaseClient
    .from('group_members')
    .select(`*, profiles(full_name, email, phone)`)
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });

  // Get recent transactions for this group
  const { data: txs } = await supabaseClient
    .from('transactions')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(5);

  const isCreator = group.created_by === currentProfile.id;
  const acceptedCount = (members || []).filter(m => m.status === 'accepted').length;
  const totalCount = (members || []).length;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;gap:1rem;">
      <div>
        <div style="font-size:1.1rem;font-weight:800;">${group.name}</div>
        <div style="font-size:.78rem;color:var(--text-400);margin-top:.15rem;">Created ${timeAgo(group.created_at)} · ${acceptedCount} active member${acceptedCount !== 1 ? 's' : ''}</div>
      </div>
      <div style="display:flex;gap:.5rem;">
        <button class="btn btn-primary btn-sm" onclick="openInviteModal()">+ Invite</button>
        <a href="pay.html?group=${groupId}" class="btn btn-accent btn-sm">💸 Pay</a>
      </div>
    </div>

    <div class="divider"></div>

    <div style="font-weight:700;font-size:.85rem;margin-bottom:.75rem;color:var(--text-400);">MEMBERS (${totalCount})</div>
    <div class="member-list" style="margin-bottom:1.25rem;">
      ${(members || []).map(m => `
        <div class="list-item">
          <div class="list-item-left">
            <div class="list-avatar">${getInitials(m.profiles?.full_name)}</div>
            <div>
              <div class="list-name">${m.profiles?.full_name || m.profiles?.email} ${m.user_id === currentProfile.id ? '<span style="color:var(--primary-light);font-size:.72rem;">(You)</span>' : ''}</div>
              <div class="list-sub">${m.profiles?.email}</div>
            </div>
          </div>
          <span class="badge ${m.status === 'accepted' ? 'badge-accent' : m.status === 'pending' ? 'badge-warning' : 'badge-danger'}">${m.status}</span>
        </div>
      `).join('')}
      ${(!members || members.length === 0) ? '<div class="empty-state" style="padding:1rem;"><p>No members yet. Invite some!</p></div>' : ''}
    </div>

    ${txs && txs.length > 0 ? `
      <div class="divider"></div>
      <div style="font-weight:700;font-size:.85rem;margin-bottom:.75rem;color:var(--text-400);">RECENT TRANSACTIONS</div>
      ${txs.map(tx => `
        <div class="list-item" style="margin-bottom:.4rem;">
          <div class="list-item-left">
            <div class="list-avatar" style="background:linear-gradient(135deg,var(--primary),var(--accent));">₹</div>
            <div>
              <div class="list-name">${formatINR(tx.total_amount)} · Split ${formatINR(tx.split_amount)} each</div>
              <div class="list-sub">${tx.payment_method} · ${timeAgo(tx.created_at)}</div>
            </div>
          </div>
          <span class="badge ${tx.status === 'completed' ? 'badge-accent' : 'badge-warning'}">${tx.status}</span>
        </div>
      `).join('')}
    ` : ''}
  `;
}

function openInviteModal() {
  if (!selectedGroupId) return;
  openModal('modal-invite');
}

async function handleCreateGroup(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-group');
  const errorEl = document.getElementById('create-group-error');
  errorEl.classList.remove('show');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  const name = document.getElementById('group-name').value.trim();

  const { data: group, error } = await supabaseClient
    .from('groups')
    .insert({ name, created_by: currentProfile.id })
    .select()
    .single();

  if (error) {
    errorEl.textContent = error.message; errorEl.classList.add('show');
    btn.innerHTML = 'Create Group'; btn.disabled = false; return;
  }

  // Add creator as accepted member
  await supabaseClient.from('group_members').insert({
    group_id: group.id, user_id: currentProfile.id, status: 'accepted', joined_at: new Date().toISOString()
  });

  showToast('Group created! 🎉', 'success');
  document.getElementById('group-name').value = '';
  closeModal('modal-create-group');
  btn.innerHTML = 'Create Group'; btn.disabled = false;
  await loadGroups();
  await selectGroup(group.id);
}

async function handleInvite(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-invite');
  const errorEl = document.getElementById('invite-error');
  errorEl.classList.remove('show');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  const email = document.getElementById('invite-email').value.trim().toLowerCase();

  // Find user by email
  const { data: profile } = await supabaseClient.from('profiles').select('id, full_name').eq('email', email).maybeSingle();
  if (!profile) {
    errorEl.textContent = 'No PayNexus account found with this email.'; errorEl.classList.add('show');
    btn.innerHTML = 'Send Invite'; btn.disabled = false; return;
  }
  if (profile.id === currentProfile.id) {
    errorEl.textContent = "You can't invite yourself."; errorEl.classList.add('show');
    btn.innerHTML = 'Send Invite'; btn.disabled = false; return;
  }


  // Check already a member
  const { data: existing } = await supabaseClient.from('group_members').select('id,status').eq('group_id', selectedGroupId).eq('user_id', profile.id).maybeSingle();
  if (existing) {
    errorEl.textContent = `${profile.full_name} is already in this group (${existing.status}).`; errorEl.classList.add('show');
    btn.innerHTML = 'Send Invite'; btn.disabled = false; return;
  }

  // Insert pending membership
  const { error } = await supabaseClient.from('group_members').insert({ group_id: selectedGroupId, user_id: profile.id, status: 'pending' });
  if (error) {
    errorEl.textContent = error.message; errorEl.classList.add('show');
    btn.innerHTML = 'Send Invite'; btn.disabled = false; return;
  }

  showToast(`Invite sent to ${profile.full_name}! ✉️`, 'success');
  document.getElementById('invite-email').value = '';
  closeModal('modal-invite');
  btn.innerHTML = 'Send Invite'; btn.disabled = false;
  await renderGroupDetail(selectedGroupId);
}

window.selectGroup = selectGroup;
window.respondInvite = respondInvite;
window.openInviteModal = openInviteModal;
