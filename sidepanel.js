// SubSphere - Side Panel Script

let currentGroupId = null;
let allGroups = [];
let allChannels = {};
let feedCache = {}; // Cache RSS feeds for 5 minutes in memory to prevent aggressive fetching

document.addEventListener("DOMContentLoaded", () => {
  init();

  // Listen for storage changes to hot-reload feeds or groups list
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.groups || changes.channels) {
      loadDataAndRender();
    }
  });
});

function init() {
  loadDataAndRender();
}

function loadDataAndRender() {
  chrome.storage.local.get(["groups", "channels"], (result) => {
    allGroups = result.groups || [];
    allChannels = result.channels || {};

    renderGroupsNavigator();

    if (currentGroupId) {
      selectGroup(currentGroupId, false); // Reload feed for current group
    } else if (allGroups.length > 0) {
      // Select the first group by default
      selectGroup(allGroups[0].id, true);
    } else {
      renderEmptyState();
    }
  });
}

// -------------------------------------------------------------
// RENDER NAVIGATOR
// -------------------------------------------------------------

function renderGroupsNavigator() {
  const container = document.getElementById("groups-scroll-list");
  if (!container) return;

  if (allGroups.length === 0) {
    container.innerHTML = `<span class="no-groups-label">No groups created</span>`;
    return;
  }

  let html = "";
  allGroups.forEach(group => {
    const isSelected = group.id === currentGroupId;
    const count = group.channelIds ? group.channelIds.length : 0;
    
    html += `
      <button class="group-nav-btn glass-card ${isSelected ? 'active' : ''}" data-group-id="${group.id}" style="--group-color: ${group.color}">
        <span class="group-nav-dot" style="background-color: hsl(${group.color})"></span>
        <span class="group-nav-name">${group.name}</span>
        <span class="group-nav-count">${count}</span>
      </button>
    `;
  });

  container.innerHTML = html;

  // Add click listeners
  container.querySelectorAll(".group-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const groupId = btn.getAttribute("data-group-id");
      selectGroup(groupId, true);
    });
  });
}

// -------------------------------------------------------------
// SELECT GROUP & LOAD FEED
// -------------------------------------------------------------

async function selectGroup(groupId, scrollToTop = true) {
  currentGroupId = groupId;
  
  // Highlight in UI
  document.querySelectorAll(".group-nav-btn").forEach(btn => {
    if (btn.getAttribute("data-group-id") === currentGroupId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const group = allGroups.find(g => g.id === currentGroupId);
  if (!group) return;

  // Update headers
  document.getElementById("current-group-title").innerText = group.name;
  document.getElementById("video-count").innerText = `${group.channelIds ? group.channelIds.length : 0} channels`;

  const feedList = document.getElementById("video-feed-list");
  if (scrollToTop) {
    feedList.scrollTop = 0;
  }

  if (!group.channelIds || group.channelIds.length === 0) {
    renderEmptyGroupState();
    return;
  }

  // Render Loading Shimmers
  renderShimmerLoader();

  try {
    const videos = await fetchGroupFeed(group.channelIds);
    renderFeed(videos);
  } catch (error) {
    console.error("Failed to load feed:", error);
    renderErrorState(error.message);
  }
}

// -------------------------------------------------------------
// FETCH & MERGE FEEDS (RSS)
// -------------------------------------------------------------

async function fetchGroupFeed(channelIds) {
  const allVideos = [];
  const now = Date.now();
  const cacheDuration = 5 * 60 * 1000; // 5 minutes cache

  // Filter channels to fetch (make sure handles are resolved)
  const fetchPromises = channelIds.map(async (channelId) => {
    let resolvedId = channelId;

    // Handle @handle type IDs which don't support RSS directly
    if (channelId.startsWith("@")) {
      resolvedId = await resolveHandleToChannelId(channelId);
      if (!resolvedId) {
        console.warn(`Could not resolve RSS feed for handle: ${channelId}`);
        return [];
      }
    }

    // Check memory cache
    if (feedCache[resolvedId] && (now - feedCache[resolvedId].timestamp < cacheDuration)) {
      return feedCache[resolvedId].videos;
    }

    // Fetch RSS feed XML text
    try {
      // Send a request to background script to fetch RSS (avoids CSP restrictions)
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "fetchChannelRSS", channelId: resolvedId }, resolve);
      });

      if (!response || !response.success) {
        throw new Error(response ? response.error : "Unknown background fetch error");
      }

      const parsedVideos = parseRSSXML(response.xml, channelId);
      
      // Save in cache
      feedCache[resolvedId] = {
        timestamp: now,
        videos: parsedVideos
      };

      return parsedVideos;
    } catch (e) {
      console.error(`Error loading RSS for channel ${channelId}:`, e);
      
      // If error occurs, fallback to cached data if it exists (even if expired)
      if (feedCache[resolvedId]) {
        console.log(`Using expired cache fallback for ${channelId}`);
        return feedCache[resolvedId].videos;
      }
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  results.forEach(videos => allVideos.push(...videos));

  // Sort chronologically (newest first)
  allVideos.sort((a, b) => b.publishedDate - a.publishedDate);

  return allVideos;
}

// Resolve handle (e.g. @MrBeast) to channel ID (UC...) using YouTube html scrapings
async function resolveHandleToChannelId(handle) {
  // Check if we already resolved and cached it inside our channels dictionary
  if (allChannels[handle] && allChannels[handle].resolvedId) {
    return allChannels[handle].resolvedId;
  }

  try {
    console.log(`Resolving handle: ${handle}`);
    const res = await fetch(`https://www.youtube.com/${handle}`);
    const htmlText = await res.text();

    // Extract channelId meta tag: <meta itemprop="channelId" content="UC...">
    const match = htmlText.match(/<meta itemprop="channelId" content="(UC[^"]+)"/);
    if (match && match[1]) {
      const resolvedId = match[1];

      // Update in storage channels map
      allChannels[handle] = {
        ...allChannels[handle],
        resolvedId: resolvedId
      };
      chrome.storage.local.set({ channels: allChannels });

      return resolvedId;
    }
  } catch (error) {
    console.error(`Failed to resolve handle ${handle}:`, error);
  }

  return null;
}

// Parse RSS XML string into video object arrays
function parseRSSXML(xmlText, originalChannelId) {
  const videos = [];
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const entries = xmlDoc.getElementsByTagName("entry");

  const channelObj = allChannels[originalChannelId] || {};
  const channelName = channelObj.name || xmlDoc.getElementsByTagName("title")[0]?.textContent || "Subscribed Channel";
  const channelAvatar = channelObj.avatar || "";

  for (let i = 0; i < Math.min(entries.length, 10); i++) {
    const entry = entries[i];
    
    // Extract video ID
    const videoIdEl = entry.getElementsByTagName("yt:videoId")[0] || entry.getElementsByTagName("videoId")[0];
    const videoId = videoIdEl ? videoIdEl.textContent : "";
    if (!videoId) continue;

    // Title
    const title = entry.getElementsByTagName("title")[0]?.textContent || "Untitled Video";
    
    // Links
    const link = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Publication Dates
    const publishedStr = entry.getElementsByTagName("published")[0]?.textContent || "";
    const publishedDate = publishedStr ? new Date(publishedStr) : new Date();

    // Thumbnail (Fallback to YouTube standard maxresdefault or mqdefault)
    const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    videos.push({
      videoId,
      title,
      link,
      publishedStr,
      publishedDate,
      channelId: originalChannelId,
      channelName,
      channelAvatar,
      thumbnail
    });
  }

  return videos;
}

// -------------------------------------------------------------
// RENDER VIDEO FEED
// -------------------------------------------------------------

function renderFeed(videos) {
  const container = document.getElementById("video-feed-list");
  if (!container) return;

  if (videos.length === 0) {
    container.innerHTML = `
      <div class="feed-placeholder">
        <span class="placeholder-icon">📭</span>
        <p>No recent videos found</p>
        <span class="placeholder-sub">Make sure the channels in this group are active or check your network connections.</span>
      </div>
    `;
    return;
  }

  // Update header badge with actual count
  document.getElementById("video-count").innerText = `${videos.length} videos`;

  let html = "";
  videos.forEach(video => {
    const timeAgo = formatTimeAgo(video.publishedDate);
    const accentColor = allGroups.find(g => g.id === currentGroupId)?.color || "260, 85%, 60%";

    html += `
      <article class="video-card glass-card animate-slide-up" data-link="${video.link}">
        <!-- Thumbnail Section -->
        <div class="video-thumbnail-container">
          <img class="video-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
          <span class="video-play-hover" style="background: rgba(var(--accent-primary-rgb), 0.2)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </span>
        </div>

        <!-- Video Description Metadata -->
        <div class="video-metadata">
          <h4 class="video-title" title="${video.title}">${video.title}</h4>
          
          <div class="video-channel-row">
            <div class="channel-info">
              ${video.channelAvatar ? `<img class="channel-avatar" src="${video.channelAvatar}" alt="${video.channelName}">` : `<span class="channel-avatar-placeholder" style="background-color: hsl(${accentColor})"></span>`}
              <span class="channel-name" title="${video.channelName}">${video.channelName}</span>
            </div>
            <span class="video-time-tag">${timeAgo}</span>
          </div>
        </div>
      </article>
    `;
  });

  container.innerHTML = html;

  // Add click links to cards
  container.querySelectorAll(".video-card").forEach(card => {
    card.addEventListener("click", () => {
      const link = card.getAttribute("data-link");
      window.open(link, "_blank");
    });
  });
}

// -------------------------------------------------------------
// STATUS / PLACEHOLDER RENDERING
// -------------------------------------------------------------

function renderShimmerLoader() {
  const container = document.getElementById("video-feed-list");
  if (!container) return;

  let shimmers = "";
  for (let i = 0; i < 4; i++) {
    shimmers += `
      <div class="shimmer-card glass-card">
        <div class="shimmer-thumb shimmer-animation"></div>
        <div class="shimmer-meta">
          <div class="shimmer-line title shimmer-animation"></div>
          <div class="shimmer-line subtitle shimmer-animation"></div>
          <div class="shimmer-row">
            <div class="shimmer-avatar shimmer-animation"></div>
            <div class="shimmer-line name shimmer-animation"></div>
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = shimmers;
}

function renderEmptyState() {
  const container = document.getElementById("video-feed-list");
  if (container) {
    container.innerHTML = `
      <div class="feed-placeholder">
        <span class="placeholder-icon">🛠️</span>
        <p>No Groups Created</p>
        <span class="placeholder-sub">Open the Organizer Dashboard (button in top-right) to create your custom groups and organize channels!</span>
      </div>
    `;
  }
}

function renderEmptyGroupState() {
  const container = document.getElementById("video-feed-list");
  if (container) {
    container.innerHTML = `
      <div class="feed-placeholder">
        <span class="placeholder-icon">📂</span>
        <p>This group is empty</p>
        <span class="placeholder-sub">Add channels to this folder by opening YouTube and clicking the "Organize" button on channel pages, or do it inside the full Dashboard!</span>
        <a href="dashboard.html" target="_blank" class="btn btn-primary" style="margin-top: 16px;">
          Go to Dashboard
        </a>
      </div>
    `;
  }
}

function renderErrorState(message) {
  const container = document.getElementById("video-feed-list");
  if (container) {
    container.innerHTML = `
      <div class="feed-placeholder">
        <span class="placeholder-icon">⚠️</span>
        <p>Failed to load feed</p>
        <span class="placeholder-sub">${message}</span>
        <button class="btn btn-secondary" onclick="location.reload()" style="margin-top: 12px;">Retry</button>
      </div>
    `;
  }
}

// Helper to format Time Ago (e.g. "3 hours ago")
function formatTimeAgo(dateObj) {
  const seconds = Math.floor((new Date() - dateObj) / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "Last week";
  if (weeks < 4) return `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return "Last month";
  return `${months} months ago`;
}
