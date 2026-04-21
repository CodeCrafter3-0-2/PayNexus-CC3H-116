document.addEventListener('DOMContentLoaded', () => {
  // Theme logic
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeToggle = document.getElementById('theme-toggle');

  function updateThemeIcon(theme) {
    if (themeToggle) {
      themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
      themeToggle.title = theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    }
  }

  // Set icon immediately (removes ?? placeholder)
  updateThemeIcon(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeIcon(newTheme);
      if (window.lucide) { window.lucide.createIcons(); }
    });
  }

  // Inject Apple Mesh Gradients Background
  if (!document.querySelector('.bg-orbs')) {
    const orbs = document.createElement('div');
    orbs.className = 'bg-orbs';
    orbs.innerHTML = `
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
    `;
    // Insert as first child of body
    document.body.insertBefore(orbs, document.body.firstChild);
  }
});

