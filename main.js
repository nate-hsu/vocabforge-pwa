// VocabForge PWA — Navigation + Service Worker Registration

// Navigation
document.querySelectorAll('.nav-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var target = btn.getAttribute('data-view');
        document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(function(v) { v.hidden = true; v.classList.remove('active'); });
        var view = document.getElementById('view-' + target);
        view.hidden = false;
        view.classList.add('active');
        if (target === 'dashboard' && typeof renderDashboard === 'function') {
            renderDashboard();
        }
        if (target === 'quiz' && typeof initQuizView === 'function') {
            initQuizView();
        }
    });
});

// Service Worker registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
