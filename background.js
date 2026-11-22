// SubSphere - Background Service Worker

// Initialize default subscription groups and mock channels showcase on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("SubSphere Extension Installed!");

  chrome.storage.local.get(["groups", "channels"], (result) => {
    // Check if channels dictionary is empty - seed mock channels for an immediate premium showcase!
    if (!result.channels || Object.keys(result.channels).length === 0) {
      const mockChannels = {
        "UCBJycsmduvYELgTAdgr8s8g": {
          id: "UCBJycsmduvYELgTAdgr8s8g",
          name: "Marques Brownlee (MKBHD)",
          avatar: "https://yt3.googleusercontent.com/lkH37D7g2nv0KOfWS7s29DnIUe6xgEqgqa4Z430ZaD8COzSySiuWPrSbCJD7mrlAIYxje58A=s176-c-k-c0x00ffffff-no-rj"
        },
        "UC8butISFwT-Wl7EV0hUK0BQ": {
          id: "UC8butISFwT-Wl7EV0hUK0BQ",
          name: "Fireship",
          avatar: "https://yt3.googleusercontent.com/ytc/AIdrodkJ4q4x63_39a-r_r067Jc4_56wApe-N7693YlW97QW6k8=s176-c-k-c0x00ffffff-no-rj"
        },
        "UCKy1dAqELo0B-jua29FGg3g": {
          id: "UCKy1dAqELo0B-jua29FGg3g",
          name: "IGN",
          avatar: "https://yt3.googleusercontent.com/H_vgJre2Y9s27as_1s1SpPGNumi1qy98hp4wtstf5Y9zz4m5aR4sV2v18nbu4_QD8n-NPTQ7=s176-c-k-c0x00ffffff-no-rj"
        },
        "UCSJ4gkVC6NrvII8umztf0Ow": {
          id: "UCSJ4gkVC6NrvII8umztf0Ow",
          name: "Lofi Girl",
          avatar: "https://yt3.googleusercontent.com/O86294XpH1o6qD4JqV3_G37D06QyBvI66P8N94A7Vw0rO2e6q5-g_e1P4a36D2Vb47a9D88A=s176-c-k-c0x00ffffff-no-rj"
        },
        "UCbfYPyITQ-7t4tOfIaLyf3g": {
          id: "UCbfYPyITQ-7t4tOfIaLyf3g",
          name: "Veritasium",
          avatar: "https://yt3.googleusercontent.com/ytc/AIdrodrr62H1zDqGjYy11mK47V2P29xW2V6Q2g9w6U18x_gQ0P8=s176-c-k-c0x00ffffff-no-rj"
        },
        "UCY1kMZp36IQSyNx_9y4qGKQ": {
          id: "UCY1kMZp36IQSyNx_9y4qGKQ",
          name: "Mark Rober",
          avatar: "https://yt3.googleusercontent.com/ytc/AIdrodrgH4Z1U4UaD1ZfO_Q8w91Yp8n1D98U76yD1V6P5w=s176-c-k-c0x00ffffff-no-rj"
        }
      };

      chrome.storage.local.set({ channels: mockChannels });
      console.log("Mock showcase channels seeded!");

      // Seed default groups mapped with these mock channels
      const defaultGroups = [
        {
          id: "group_tech",
          name: "Tech & Dev",
          color: "260, 85%, 60%", // Violet-purple
          channelIds: ["UCBJycsmduvYELgTAdgr8s8g", "UC8butISFwT-Wl7EV0hUK0BQ"]
        },
        {
          id: "group_gaming",
          name: "Gaming",
          color: "350, 85%, 55%", // Crimson red
          channelIds: ["UCKy1dAqELo0B-jua29FGg3g"]
        },
        {
          id: "group_music",
          name: "Music",
          color: "145, 80%, 45%", // Emerald green
          channelIds: ["UCSJ4gkVC6NrvII8umztf0Ow"]
        },
        {
          id: "group_edu",
          name: "Education & Sci",
          color: "195, 85%, 45%", // Cyan blue
          channelIds: ["UCbfYPyITQ-7t4tOfIaLyf3g", "UCY1kMZp36IQSyNx_9y4qGKQ"]
        },
        {
          id: "group_ent",
          name: "Entertainment",
          color: "35, 90%, 55%", // Warm orange
          channelIds: []
        }
      ];

      chrome.storage.local.set({ groups: defaultGroups });
      console.log("Default subscription groups and mock channel mappings seeded successfully!");
    }
  });

  // Query open YouTube tabs and inject content script programmatically on install/reload
  chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }).then(() => {
        console.log(`SubSphere: Auto-injected content script into open YouTube tab: ${tab.id}`);
      }).catch(err => console.log("Script injection failed for tab:", tab.id, err));
      
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      }).catch(err => console.log("CSS injection failed for tab:", tab.id, err));
    });
  });
});

// Listener for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSidePanel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ tabId: tabs[0].id }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return true; 
  }

  if (request.action === "fetchChannelRSS") {
    fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${request.channelId}`)
      .then(response => response.text())
      .then(xmlText => {
        sendResponse({ success: true, xml: xmlText });
      })
      .catch(error => {
        console.error("RSS fetch failed", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
