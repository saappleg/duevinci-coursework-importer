// Authentication remains in the user's DueVinci tab and is read only when
// the user explicitly connects from the extension popup.
document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  if (status) status.textContent = 'No credentials are stored by this extension.';
});
