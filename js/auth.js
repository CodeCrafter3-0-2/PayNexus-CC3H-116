// ============================================================
// PayNexus — Auth Logic
// ============================================================

document.addEventListener('DOMContentLoaded', () => {  // Toggle forms
  // Forgot Password Toggle
  document.getElementById('link-forgot').addEventListener('click', e => { e.preventDefault(); showForgot(); });
  document.getElementById('back-to-login').addEventListener('click', e => { e.preventDefault(); showLogin(); });

  // Forgot Form Submit
  document.getElementById('form-forgot').addEventListener('submit', handleForgot);

  // Login
  document.getElementById('form-login').addEventListener('submit', handleLogin);

  // Signup
  document.getElementById('form-signup').addEventListener('submit', handleSignup);

  // Lucide Icons
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Check URL param BEFORE potentially redirecting
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'signup') showSignup();

  // Redirect if already logged in (non-blocking)
  if (typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) { window.location.href = 'dashboard.html'; }
    }).catch(err => console.error("Supabase error:", err));
  } else {
    console.error("Supabase is not loaded. Please check your internet connection and CDN links.");
    showToast("Application failed to load completely. Check your connection.", "error");
  }
});

function showSignup() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'block';
  document.getElementById('auth-title').textContent = 'Create Account';
  document.getElementById('auth-sub').textContent = 'Join PayNexus and start splitting payments';
}

function showLogin() {
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('auth-title').textContent = 'Welcome Back';
  document.getElementById('auth-sub').textContent = 'Sign in to your PayNexus account';
}

function showForgot() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'block';
  document.getElementById('auth-title').textContent = 'Reset Password';
  document.getElementById('auth-sub').textContent = 'Enter your email to receive a recovery link';
}

async function handleForgot(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-forgot');
  const errorEl = document.getElementById('forgot-error');
  const email = document.getElementById('forgot-email').value.trim();
  
  errorEl.classList.remove('show');
  btn.innerHTML = '<span class="spinner"></span> Sending...';
  btn.disabled = true;

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html',
  });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.add('show');
    btn.innerHTML = 'Send Reset Link';
    btn.disabled = false;
  } else {
    showToast('Success! Check your email for the reset link.', 'success');
    btn.innerHTML = 'Email Sent ✅';
    setTimeout(() => showLogin(), 3000);
  }
}

function checkStrength(password) {
  const label = document.getElementById('strength-label');
  const s1 = document.getElementById('seg-1');
  const s2 = document.getElementById('seg-2');
  const s3 = document.getElementById('seg-3');
  
  // Clear
  [s1, s2, s3].forEach(s => s.className = 'strength-segment');
  
  if (password.length === 0) { label.textContent = 'Security: Too short'; return; }
  
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10 || (/[0-9]/.test(password) && /[A-Z]/.test(password))) score++;
  if (password.length >= 12 && /[!@#$%^&*]/.test(password)) score++;
  
  if (score === 1) {
    label.textContent = 'Security: Weak';
    s1.classList.add('strength-weak');
  } else if (score === 2) {
    label.textContent = 'Security: Moderate';
    s1.classList.add('strength-medium');
    s2.classList.add('strength-medium');
  } else if (score === 3) {
    label.textContent = 'Security: Strong';
    s1.classList.add('strength-strong');
    s2.classList.add('strength-strong');
    s3.classList.add('strength-strong');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const errorEl = document.getElementById('login-error');
  errorEl.classList.remove('show');
  btn.innerHTML = '<span class="spinner"></span> Signing in...';
  btn.disabled = true;

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.add('show');
    btn.innerHTML = 'Sign In';
    btn.disabled = false;
  } else {
    showToast('Signed in successfully!', 'success');
    setTimeout(() => window.location.href = 'dashboard.html', 600);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-signup');
  const errorEl = document.getElementById('signup-error');
  errorEl.classList.remove('show');
  btn.innerHTML = '<span class="spinner"></span> Creating account...';
  btn.disabled = true;

  try {
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const phoneCode = document.getElementById('signup-country').value;
    const phoneRaw = document.getElementById('signup-phone').value.trim();
    const phone = phoneCode + phoneRaw;
    const password = document.getElementById('signup-password').value;
    const transactionPin = document.getElementById('signup-pin').value;

    // Check phone unique
    const { data: existing, error: findErr } = await supabaseClient.from('profiles').select('id').eq('phone', phone).maybeSingle();
    
    if (findErr) throw findErr;
    
    if (existing) {
      errorEl.textContent = 'This phone number is already registered.';
      errorEl.classList.add('show');
      btn.innerHTML = 'Create Account';
      btn.disabled = false;
      return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { full_name: name, phone, transaction_pin: transactionPin } }
    });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('show');
      btn.innerHTML = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Supabase has email confirmation enabled by default.
    // If session is null, it means they need to confirm their email.
    if (!data.session) {
      showToast('Confirmation email sent! Please verify to login.', 'info');
      btn.innerHTML = 'Create Account';
      btn.disabled = false;
      
      // Switch to login form automatically
      setTimeout(() => {
        showLogin();
        document.getElementById('login-email').value = email;
      }, 2000);
      return;
    }

    showToast('Account created! Signing you in...', 'success');
    setTimeout(() => window.location.href = 'dashboard.html', 800);
  } catch (err) {
    console.error("Signup error details:", err);
    errorEl.textContent = err.message || "An unexpected error occurred.";
    errorEl.classList.add('show');
    btn.innerHTML = 'Create Account';
    btn.disabled = false;
  }
}

