/**
 * Perception Events Panel Component
 * Displays real-time scrolling event log with colored type markers.
 */

export function createEventsPanel(container) {
  container.innerHTML = `
    <div class="rs-card events-card">
      <div class="card-header">
        <h2 class="card-title">PERCEPTION EVENTS</h2>
      </div>
      <div class="card-body events-scroll-container">
        <div class="events-list" id="events-list-container">
          <!-- Dynamically populated -->
        </div>
      </div>
    </div>
  `;

  const listContainer = container.querySelector('#events-list-container');

  return {
    update(eventsData) {
      if (!eventsData || !Array.isArray(eventsData)) return;

      listContainer.innerHTML = eventsData.map(ev => `
        <div class="event-row">
          <span class="event-dot" style="background-color: ${ev.color || '#00e676'}; box-shadow: 0 0 6px ${ev.color || '#00e676'};"></span>
          <span class="event-time font-mono">${ev.timestamp}</span>
          <span class="event-text">${ev.text}</span>
        </div>
      `).join('');
    }
  };
}
