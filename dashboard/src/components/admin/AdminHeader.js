/**
 * Admin Console Header — mirrors the main dashboard's header chrome
 * (rs-header / rs-logo-badge / status-pill classes from dashboard.css)
 * so the two pages read as one product, with a link back to the live view.
 */

export function createAdminHeader(container) {
  container.innerHTML = `
    <header class="rs-header">
      <div class="header-left">
        <div class="rs-logo-badge">RS</div>
        <div class="rs-title-group">
          <span class="rs-title">RAKSHASETU</span>
          <span class="rs-subtitle">ADAPTIVE 2.5D LIDAR PERCEPTION &middot; SIH PS 26053 &middot; DRDO</span>
        </div>
      </div>
      <div class="header-center">
        <a href="./index.html" class="live-perception-pill" style="text-decoration:none;">
          <span class="pulse-cyan-dot"></span>
          &larr; LIVE PERCEPTION
        </a>
      </div>
      <div class="header-right">
        <div class="mode-pill">
          <span class="mode-label">MODE</span>
          <span class="mode-val" id="admin-mode-val">ADMIN CONSOLE</span>
        </div>
        <div class="status-pill">
          <span class="online-dot"></span>
          <span class="status-text">SYSTEM ONLINE</span>
        </div>
        <div class="clock-display" id="admin-clock">--:--:--</div>
      </div>
    </header>
  `;

  const clockElem = container.querySelector('#admin-clock');

  return {
    update(scene) {
      if (clockElem && scene?.system_time) clockElem.textContent = scene.system_time;
    }
  };
}
