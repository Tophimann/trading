// SubSphere - Popup JS

document.addEventListener("DOMContentLoaded", () => {
  updateStats();

  // Button to open Chrome Extension Side Panel
  const btnOpenSidebar = document.getElementById("btn-open-sidebar");
  if (btnOpenSidebar) {
    btnOpenSidebar.addEventListener("click", () => {
      // In MV3, sidePanel.open works directly in Action click if permissions/behaviors are set
      chrome.windows.getCurrent((currentWindow) => {
        chrome.sidePanel.open({ windowId: currentWindow.id }, () => {
          // Close popup after opening sidebar so user can see it
          window.close();
        });
      });
    });
  }

  // Button to open full Dashboard Workspace
  const btnOpenDashboard = document.getElementById("btn-open-dashboard");
  if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener("click", () => {
      chrome.tabs.create({ url: "dashboard.html" });
    });
  }
});

// Update display statistics
function updateStats() {
  chrome.storage.local.get(["groups", "channels"], (result) => {
    const groups = result.groups || [];
    const channels = result.channels || {};

    const groupCount = groups.length;
    const channelCount = Object.keys(channels).length;

    // Set stats in elements
    document.getElementById("stat-groups").innerText = groupCount;
    document.getElementById("stat-channels").innerText = channelCount;

    // Count how many channels are organized inside groups
    let organizedCount = 0;
    const organizedIds = new Set();
    groups.forEach(g => {
      if (g.channelIds) {
        g.channelIds.forEach(id => organizedIds.add(id));
      }
    });
    organizedCount = organizedIds.size;

    const syncTimeVal = document.getElementById("sync-time-val");
    if (channelCount > 0) {
      syncTimeVal.innerText = `${organizedCount} of ${channelCount} channels organized`;
    } else {
      syncTimeVal.innerText = "Visit YouTube to sync channels";
    }
  });
}
