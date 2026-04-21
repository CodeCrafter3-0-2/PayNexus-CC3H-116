// ============================================================
// PayNexus — Supabase Client Initialization
// ============================================================

const SUPABASE_URL = 'https://mktcefthlrifadsxyelc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rdGNlZnRobHJpZmFkc3h5ZWxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NTkwNjUsImV4cCI6MjA5MjMzNTA2NX0.Yb_T4N27sKzDG7FaIjJG4PHuo434W9NjlNeGVVCXdhM';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;

// ── Toast Notification ──
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: '💬', warning: '⚠️' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '💬'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 350); }, 3500);
}

function createToastContainer() {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
  return el;
}

// ── Auth Guard ──
async function requireAuth(redirectTo = 'login.html') {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = redirectTo; return null; }
  return session;
}

// ── Get current user profile ──
async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

// ── Format currency ──
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Initials ──
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// ── Time ago ──
function timeAgo(dateStr) {
  const now = new Date(); const d = new Date(dateStr);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

// ── Modal helpers ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Emails (Vercel Serverless + Gmail) ──
async function sendPaymentEmail(to, subject, html) {
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html })
    });
    const data = await res.json();
    console.log("Email status:", data);
    return data;
  } catch (err) {
    console.error("Failed to send email via Vercel:", err);
  }
}
