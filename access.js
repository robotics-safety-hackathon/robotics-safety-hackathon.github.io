'use strict';

// Casual access gate only. GitHub Pages files and repository contents remain public.
(() => {
  const key = 'robotics-safety-hackathon-access';
  const form = document.getElementById('access-form');
  const input = document.getElementById('access-password');
  const button = document.getElementById('access-submit');
  const error = document.getElementById('access-error');
  let loading = false;

  function openPresentation() {
    if (loading) return;
    loading = true;
    button.disabled = true;
    button.textContent = 'Opening…';
    const script = document.createElement('script');
    script.src = 'app.js?v=layout-privacy';
    script.onload = () => {
      try { sessionStorage.setItem(key, '1'); } catch { /* Storage may be disabled. */ }
      document.getElementById('access-gate').hidden = true;
      document.body.classList.remove('access-locked');
      document.getElementById('presentation').focus({ preventScroll: true });
    };
    script.onerror = () => {
      script.remove();
      loading = false;
      button.disabled = false;
      button.textContent = 'Enter';
      error.textContent = 'Could not load the presentation. Please try again.';
    };
    document.head.append(script);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value !== '1114') {
      error.textContent = 'Incorrect password.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      input.select();
      return;
    }
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    openPresentation();
  });

  try {
    if (sessionStorage.getItem(key) === '1') openPresentation();
  } catch { /* The password form still works without session storage. */ }
})();
