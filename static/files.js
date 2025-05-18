document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('menuToggle');

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    if (sidebar.classList.contains('hidden')) {
      toggleBtn.textContent = '☰'; // hamburger icon
    } else {
      toggleBtn.textContent = '✕'; // close icon
    }
  });
});
