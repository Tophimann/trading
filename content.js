// SubSphere - YouTube Content Script

console.log("SubSphere active on YouTube!");

// Global state variables
let lastUrl = location.href;
let floatingMenuElement = null;

// Initialization
function init() {
  // 1. Scrape sidebar subscriptions immediately and then periodically
  scrapeSidebarSubscriptions();
  setupSidebarObserver();

  // 2. Inject groups section in the sidebar immediately and verify every 2 seconds
  injectSidebarGroups();
  setInterval(() => {
    if (!document.getElementById('subsphere-sidebar-section')) {
      injectSidebarGroups();
    }
  }, 2000);

  // 3. Inject "+ Add to Group" button on channel pages immediately and verify every 1.5 seconds
  injectAddToGroupButton();
  setInterval(() => {
    const isChannelPage = location.href.includes('/@') || location.href.includes('/channel/') || location.href.includes('/c/');
    if (isChannelPage && !document.getElementById('subsphere-add-to-group-btn')) {
      injectAddToGroupButton();
    }
  }, 2000);

  // 4. Register global storage listener once
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.groups) {
      renderSidebarGroups();
    }
  });

  // Handle page transitions (YouTube is a single-page app)
  observeUrlChanges();
}

// Observe URL changes for single-page application navigation
function observeUrlChanges() {
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      
      // Close any open menus
      closeFloatingMenu();

      // Retry injections for the new page context
      setTimeout(() => {
        injectAddToGroupButton();
        injectSidebarGroups();
        scrapeSidebarSubscriptions();
      }, 1000);
    }
  });

  observer.observe(document.querySelector('body'), { childList: true, subtree: true });
}

// -------------------------------------------------------------
// PART 1: SCRAPING YOUTUBE SUBSCRIPTIONS
// -------------------------------------------------------------

function scrapeSidebarSubscriptions() {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
  // Find all guide entry renderers in the sidebar
  const entries = document.querySelectorAll('ytd-guide-entry-renderer');
  if (entries.length === 0) return;

  const foundChannels = {};

  entries.forEach(entry => {
    const linkEl = entry.querySelector('a#endpoint');
    if (!linkEl) return;

    const href = linkEl.getAttribute('href') || '';
    
    // Check if the link points to a channel
    if (href.includes('/channel/') || href.includes('/@')) {
      const channelNameEl = entry.querySelector('.title') || entry.querySelector('yt-formatted-string') || entry.querySelector('#endpoint span');
      
      if (channelNameEl) {
        const channelName = channelNameEl.innerText.trim();
        
        // Skip default navigation items
        if (!channelName || channelName === "All subscriptions" || channelName === "Subscriptions" || channelName === "Alle Abos" || channelName === "Abos" || channelName === "Kanäle verwalten") return;

        // Pierce shadow DOM for avatar img (YouTube wraps avatar images in shadow roots)
        const ytImg = entry.querySelector('yt-img-shadow');
        let avatarUrl = '';
        if (ytImg) {
          const img = ytImg.shadowRoot ? ytImg.shadowRoot.querySelector('img') : ytImg.querySelector('img');
          avatarUrl = img ? img.getAttribute('src') || img.src || '' : '';
        }

        // Resolve Channel ID or unique handle from href
        let channelId = '';
        if (href.includes('/channel/')) {
          channelId = href.split('/channel/')[1].split('?')[0];
        } else if (href.includes('/@')) {
          channelId = '@' + href.split('/@')[1].split('?')[0];
        }

        if (channelId) {
          foundChannels[channelId] = {
            id: channelId,
            name: channelName,
            avatar: avatarUrl
          };
        }
      }
    }
  });

  // Sync found channels with chrome.storage.local
  if (Object.keys(foundChannels).length > 0) {
    chrome.storage.local.get(["channels"], (result) => {
      const existingChannels = result.channels || {};
      let updated = false;

      Object.keys(foundChannels).forEach(id => {
        if (!existingChannels[id] || existingChannels[id].avatar !== foundChannels[id].avatar || existingChannels[id].name !== foundChannels[id].name) {
          existingChannels[id] = {
            ...existingChannels[id],
            id: id,
            name: foundChannels[id].name,
            avatar: foundChannels[id].avatar
          };
          updated = true;
        }
      });

      if (updated) {
        chrome.storage.local.set({ channels: existingChannels }, () => {
          console.log(`SubSphere: Auto-synced ${Object.keys(foundChannels).length} channels from sidebar!`);
        });
      }
    });
  }
}

function setupSidebarObserver() {
  // Periodically check sidebar elements in case they load later or user expands "Show more"
  let scrapeCount = 0;
  const interval = setInterval(() => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
      clearInterval(interval);
      return;
    }
    scrapeSidebarSubscriptions();
    scrapeCount++;
    if (scrapeCount > 10) clearInterval(interval); // Stop polling after a while
  }, 3000);
}

// -------------------------------------------------------------
// PART 2: YOUTUBE SIDEBAR GROUPS INJECTION & DYNAMIC FILTERING
// -------------------------------------------------------------

let activeSidebarGroupId = null;

function injectSidebarGroups() {
  // Find sidebar guide sections container
  const sidebar = document.querySelector('ytd-guide-renderer #sections') || document.querySelector('#guide-content #sections');
  if (!sidebar) return;

  // Prevent duplicate injections if already in the DOM
  if (document.getElementById('subsphere-sidebar-section')) return;

  const sectionContainer = document.createElement('div');
  sectionContainer.id = 'subsphere-sidebar-section';
  sectionContainer.className = 'style-scope ytd-guide-renderer';
  sectionContainer.innerHTML = `
    <hr class="style-scope ytd-guide-divider" style="margin: 12px 0; border: none; border-top: 1px solid rgba(255, 255, 255, 0.1);">
    <h3 class="style-scope ytd-guide-section-renderer" style="font-family: Roboto, Arial, sans-serif; font-size: 14px; font-weight: 500; padding: 6px 24px; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between; width: 100%;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="subsphere-sidebar-glow-dot"></span>
        SubSphere Groups
      </div>
      <button id="subsphere-sidebar-reset-link" style="display: none; background: transparent; border: none; font-size: 11px; color: #8b5cf6; text-transform: none; cursor: pointer; padding: 0; font-weight: 600; font-family: Roboto, Arial, sans-serif;">
        Show All
      </button>
    </h3>
    <div id="subsphere-sidebar-groups-list" class="style-scope ytd-guide-section-renderer" style="padding: 4px 0;">
      <!-- Groups will be loaded here -->
    </div>
  `;

  // Insert as the second section of the sidebar, right below the home/shorts/subscriptions block
  const firstSection = sidebar.querySelector('ytd-guide-section-renderer');
  if (firstSection) {
    firstSection.insertAdjacentElement('afterend', sectionContainer);
    renderSidebarGroups();

    // Attach click action to "Show All" reset link
    document.getElementById('subsphere-sidebar-reset-link').addEventListener('click', (e) => {
      e.preventDefault();
      resetSidebarFilters();
    });
  }
}

function renderSidebarGroups() {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
  const container = document.getElementById('subsphere-sidebar-groups-list');
  if (!container) return;

  chrome.storage.local.get(["groups"], (result) => {
    const groups = result.groups || [];
    
    if (groups.length === 0) {
      container.innerHTML = `
        <div style="padding: 8px 24px; color: #666; font-size: 12px; font-style: italic;">
          No groups created. Open Dashboard to start!
        </div>
      `;
      return;
    }

    let html = '';
    groups.forEach(group => {
      const count = group.channelIds ? group.channelIds.length : 0;
      html += `
        <a class="subsphere-sidebar-item" href="#" data-group-id="${group.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 40px; text-decoration: none; color: #f1f1f1; font-family: Roboto, Arial, sans-serif; font-size: 14px; transition: background 0.15s; border-radius: 0 20px 20px 0; margin-right: 12px;">
          <div style="display: flex; align-items: center; gap: 16px;">
            <span class="subsphere-bullet-dot" style="background-color: hsl(${group.color}); box-shadow: 0 0 8px hsl(${group.color}); width: 8px; height: 8px; border-radius: 50%;"></span>
            <span class="subsphere-sidebar-item-name" style="font-weight: 500;">${group.name}</span>
          </div>
          <span style="font-size: 11px; background: rgba(255, 255, 255, 0.08); padding: 2px 8px; border-radius: 10px; color: #aaa;">${count}</span>
        </a>
      `;
    });

    container.innerHTML = html;

    // Add click events to trigger sidebar subscription list filters!
    container.querySelectorAll('.subsphere-sidebar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const groupId = item.getAttribute('data-group-id');
        filterSidebarSubscriptions(groupId);
      });
    });

    // Re-apply active filters if the sidebar just reloaded in the DOM
    if (activeSidebarGroupId) {
      const tempId = activeSidebarGroupId;
      activeSidebarGroupId = null; // Reset to bypass toggle detection
      filterSidebarSubscriptions(tempId);
    } else {
      resetSidebarFilters();
    }
  });
}

// Filter the native YouTube subscriptions list ("Abos")
function filterSidebarSubscriptions(groupId) {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  // Toggle reset if clicking active group
  if (activeSidebarGroupId === groupId) {
    resetSidebarFilters();
    return;
  }

  activeSidebarGroupId = groupId;

  // Visual highlights in sidebar
  document.querySelectorAll('.subsphere-sidebar-item').forEach(item => {
    const id = item.getAttribute('data-group-id');
    const bulletDot = item.querySelector('.subsphere-bullet-dot');
    const bulletColor = bulletDot ? bulletDot.style.backgroundColor : '#8b5cf6';
    
    if (id === groupId) {
      item.classList.add('subsphere-active-filter');
      item.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
      item.style.borderLeft = `4px solid ${bulletColor}`;
      item.style.paddingLeft = '20px'; // Offset for border
    } else {
      item.classList.remove('subsphere-active-filter');
      item.style.backgroundColor = 'transparent';
      item.style.borderLeft = 'none';
      item.style.paddingLeft = '24px';
    }
  });

  // Load target group definition & channels cache database
  chrome.storage.local.get(["groups", "channels"], (result) => {
    const groups = result.groups || [];
    const channels = result.channels || {};
    
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const allowedIds = group.channelIds || [];

    // Filter ytd-guide-entry-renderer elements in sidebar
    const entries = document.querySelectorAll('ytd-guide-entry-renderer');
    entries.forEach(entry => {
      const linkEl = entry.querySelector('a#endpoint');
      if (!linkEl) return;

      const href = linkEl.getAttribute('href') || '';
      if (href.includes('/channel/') || href.includes('/@')) {
        let channelId = '';
        if (href.includes('/channel/')) {
          channelId = href.split('/channel/')[1].split('?')[0];
        } else if (href.includes('/@')) {
          channelId = '@' + href.split('/@')[1].split('?')[0];
        }

        if (channelId) {
          // Look up resolved ID in the channels cache
          const resolved = channels[channelId]?.resolvedId || channelId;
          
          // Match if either the sidebar ID OR its resolved UC ID is inside the group
          const isAllowed = allowedIds.includes(channelId) || allowedIds.includes(resolved);

          if (isAllowed) {
            entry.style.display = 'block';
          } else {
            entry.style.display = 'none';
          }
        }
      }
    });

    // Make the "Show All" reset link visible in SubSphere header
    const resetLink = document.getElementById('subsphere-sidebar-reset-link');
    if (resetLink) resetLink.style.display = 'inline';
  });
}

// Reset filters and display all native subscriptions again
function resetSidebarFilters() {
  activeSidebarGroupId = null;

  // Clear visual highlights
  document.querySelectorAll('.subsphere-sidebar-item').forEach(item => {
    item.classList.remove('subsphere-active-filter');
    item.style.backgroundColor = 'transparent';
    item.style.borderLeft = 'none';
    item.style.paddingLeft = '24px';
  });

  // Display all hidden guide entry elements
  const entries = document.querySelectorAll('ytd-guide-entry-renderer');
  entries.forEach(entry => {
    const linkEl = entry.querySelector('a#endpoint');
    if (linkEl) {
      const href = linkEl.getAttribute('href') || '';
      if (href.includes('/channel/') || href.includes('/@')) {
        entry.style.display = 'block';
      }
    }
  });

  // Hide the "Show All" link
  const resetLink = document.getElementById('subsphere-sidebar-reset-link');
  if (resetLink) resetLink.style.display = 'none';
}

// -------------------------------------------------------------
// PART 3: CHANNEL PAGE "+ ADD TO GROUP" BUTTON
// -------------------------------------------------------------

function injectAddToGroupButton() {
  // Only inject on channel pages or watch pages where a subscribe button exists
  const subContainer = document.querySelector('#subscribe-button ytd-subscribe-button-renderer') || 
                       document.querySelector('ytd-subscribe-button-renderer');
  
  if (!subContainer) {
    // If not found immediately, wait a bit since YouTube uses AJAX loading
    return;
  }

  // Prevent duplicate injections
  if (document.getElementById('subsphere-add-to-group-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'subsphere-add-to-group-btn';
  btn.className = 'subsphere-action-btn';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
      <path d="M12 5v14M5 12h14"/>
    </svg>
    Organize
  `;

  // Styling of our inject button inside DOM
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
  btn.style.color = '#f1f1f1';
  btn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  btn.style.padding = '0 16px';
  btn.style.height = '36px';
  btn.style.fontSize = '14px';
  btn.style.fontWeight = '500';
  btn.style.borderRadius = '18px';
  btn.style.cursor = 'pointer';
  btn.style.marginLeft = '8px';
  btn.style.fontFamily = 'Roboto, Arial, sans-serif';
  btn.style.transition = 'all 0.2s';

  // Inject right next to the subscribe button
  subContainer.parentElement.appendChild(btn);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFloatingMenu(btn);
  });

  // Hover effects
  btn.addEventListener('mouseenter', () => {
    btn.style.backgroundColor = 'rgba(255, 255, 255, 0.18)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    btn.style.boxShadow = '0 0 10px rgba(255,255,255,0.05)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    btn.style.boxShadow = 'none';
  });
}

// -------------------------------------------------------------
// PART 4: FLOATING GLASSMORPHIC ORGANIZER DIALOG
// -------------------------------------------------------------

function toggleFloatingMenu(anchorBtn) {
  if (floatingMenuElement) {
    closeFloatingMenu();
    return;
  }

  // Get active channel details from metadata
  let channelId = '';
  let channelName = '';
  let avatarUrl = '';

  // Get current channel ID from metadata (super robust!)
  const idMeta = document.querySelector('meta[itemprop="channelId"]');
  if (idMeta) {
    channelId = idMeta.getAttribute('content');
  } else {
    // Attempt fallback from URL
    const url = location.href;
    if (url.includes('/channel/')) {
      channelId = url.split('/channel/')[1].split('/')[0].split('?')[0];
    } else if (url.includes('/@')) {
      channelId = '@' + url.split('/@')[1].split('/')[0].split('?')[0];
    }
  }

  // Get channel Name
  const nameMeta = document.querySelector('meta[itemprop="name"]') || document.querySelector('meta[property="og:title"]');
  if (nameMeta) {
    channelName = nameMeta.getAttribute('content');
  } else {
    const headerNameEl = document.querySelector('ytd-channel-name yt-formatted-string') || document.querySelector('#channel-name');
    if (headerNameEl) channelName = headerNameEl.innerText.trim();
  }

  // Get avatar
  const avatarMeta = document.querySelector('meta[property="og:image"]');
  if (avatarMeta) {
    avatarUrl = avatarMeta.getAttribute('content');
  } else {
    const avatarImgEl = document.querySelector('#avatar-editor yt-img-shadow img') || document.querySelector('#channel-header-container yt-img-shadow img');
    if (avatarImgEl) avatarUrl = avatarImgEl.getAttribute('src');
  }

  if (!channelId) {
    alert("Could not detect YouTube Channel ID. Please try again on a Channel home page.");
    return;
  }

  // Normalize channel values
  channelName = channelName || "Unknown YouTube Channel";
  avatarUrl = avatarUrl || "https://www.youtube.com/img/desktop/yt_1200.png";

  // Cache/ensure this channel is in our channels dict
  chrome.storage.local.get(["channels", "groups"], (result) => {
    const channels = result.channels || {};
    const groups = result.groups || [];

    channels[channelId] = {
      id: channelId,
      name: channelName,
      avatar: avatarUrl
    };
    chrome.storage.local.set({ channels: channels });

    // Create the floating menu
    createFloatingMenu(anchorBtn, channelId, channelName, groups);
  });
}

function createFloatingMenu(anchorBtn, channelId, channelName, groups) {
  const rect = anchorBtn.getBoundingClientRect();

  floatingMenuElement = document.createElement('div');
  floatingMenuElement.id = 'subsphere-floating-menu';
  floatingMenuElement.className = 'subsphere-floating-card';
  floatingMenuElement.style.position = 'fixed';
  floatingMenuElement.style.top = `${rect.bottom + window.scrollY + 10}px`;
  floatingMenuElement.style.left = `${rect.left + window.scrollX - 80}px`;
  floatingMenuElement.style.zIndex = '99999';
  floatingMenuElement.style.width = '260px';
  floatingMenuElement.style.background = '#0f111a';
  floatingMenuElement.style.border = '1px solid rgba(255, 255, 255, 0.1)';
  floatingMenuElement.style.borderRadius = '14px';
  floatingMenuElement.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(139, 92, 246, 0.1)';
  floatingMenuElement.style.padding = '16px';
  floatingMenuElement.style.fontFamily = 'Roboto, Arial, sans-serif';
  floatingMenuElement.style.color = '#fff';
  floatingMenuElement.style.animation = 'subsphereFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)';

  let groupsHtml = '';
  groups.forEach(group => {
    const isChecked = group.channelIds && group.channelIds.includes(channelId);
    groupsHtml += `
      <label class="subsphere-checkbox-row" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 6px; border-radius: 8px; cursor: pointer; transition: background 0.15s; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="background-color: hsl(${group.color}); width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>
          <span style="font-size: 13px; font-weight: 500; color: #e1e1e1;">${group.name}</span>
        </div>
        <input type="checkbox" class="subsphere-group-checkbox" data-group-id="${group.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #8b5cf6;">
      </label>
    `;
  });

  floatingMenuElement.innerHTML = `
    <div style="font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">Add channel to:</div>
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 12px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
      ${channelName}
    </div>
    <div class="subsphere-groups-scroller" style="max-height: 180px; overflow-y: auto; margin-bottom: 12px; padding-right: 4px;">
      ${groupsHtml || '<div style="color: #666; font-size: 12px; font-style: italic; padding: 10px 0;">No groups available.</div>'}
    </div>
    <div style="display: flex; gap: 8px;">
      <a href="${chrome?.runtime?.getURL ? chrome.runtime.getURL('dashboard.html') : '#'}" target="_blank" style="flex: 1; text-align: center; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c084fc; padding: 6px 0; border-radius: 6px; font-size: 12px; text-decoration: none; font-weight: 500; transition: background 0.2s;">
        Manage Groups
      </a>
      <button id="subsphere-close-dialog-btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #ccc; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500; transition: background 0.2s;">
        Close
      </button>
    </div>
  `;

  document.body.appendChild(floatingMenuElement);

  // Position fixes in case it flows offscreen
  const bounds = floatingMenuElement.getBoundingClientRect();
  if (bounds.right > window.innerWidth) {
    floatingMenuElement.style.left = `${window.innerWidth - bounds.width - 20}px`;
  }
  if (bounds.bottom > window.innerHeight) {
    floatingMenuElement.style.top = `${rect.top + window.scrollY - bounds.height - 10}px`;
  }

  // Handle row click animations
  floatingMenuElement.querySelectorAll('.subsphere-checkbox-row').forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });
  });

  // Checkbox functionality
  floatingMenuElement.querySelectorAll('.subsphere-group-checkbox').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const groupId = chk.getAttribute('data-group-id');
      const isChecked = chk.checked;

      chrome.storage.local.get(["groups"], (result) => {
        const groups = result.groups || [];
        const targetGroup = groups.find(g => g.id === groupId);

        if (targetGroup) {
          if (!targetGroup.channelIds) targetGroup.channelIds = [];

          if (isChecked) {
            if (!targetGroup.channelIds.includes(channelId)) {
              targetGroup.channelIds.push(channelId);
            }
          } else {
            targetGroup.channelIds = targetGroup.channelIds.filter(id => id !== channelId);
          }

          chrome.storage.local.set({ groups: groups }, () => {
            console.log(`SubSphere: Updated channel ${channelId} group assignment inside ${groupId}!`);
          });
        }
      });
    });
  });

  // Close button
  document.getElementById('subsphere-close-dialog-btn').addEventListener('click', closeFloatingMenu);

  // Click outside listener to dismiss menu
  document.addEventListener('click', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (floatingMenuElement && !floatingMenuElement.contains(e.target) && !e.target.closest('#subsphere-add-to-group-btn')) {
    closeFloatingMenu();
  }
}

function closeFloatingMenu() {
  if (floatingMenuElement) {
    floatingMenuElement.remove();
    floatingMenuElement = null;
    document.removeEventListener('click', handleOutsideClick);
  }
}

// -------------------------------------------------------------
// INITIAL RUN
// -------------------------------------------------------------

// Wait for document to settle before init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
} else {
  setTimeout(init, 1000);
}
