// SubSphere - Organizer Dashboard Script

// App State
let allGroups = [];
let allChannels = {};
let activeGroupId = null;
let currentTab = "all"; // "all" or "unassigned"
let searchFilter = "";

// Modal Editing State
let editingGroupId = null;
const hslColorsPreset = [
  "260, 85%, 60%",  // Violet purple
  "350, 85%, 55%",  // Crimson red
  "35, 90%, 55%",   // Warm orange
  "145, 80%, 45%",  // Emerald green
  "195, 85%, 45%",  // Cyan blue
  "290, 80%, 55%",  // Fuchsia magenta
  "175, 85%, 40%",  // Teal
  "45, 90%, 50%"    // Golden yellow
];
let selectedModalColor = hslColorsPreset[0];

document.addEventListener("DOMContentLoaded", () => {
  init();
  setupEventListeners();
});

function init() {
  loadData();

  // Parse URL query parameter for pre-selected group
  const urlParams = new URLSearchParams(window.location.search);
  const preSelectedGroup = urlParams.get('group');
  if (preSelectedGroup) {
    activeGroupId = preSelectedGroup;
  }
}

function loadData() {
  chrome.storage.local.get(["groups", "channels"], (result) => {
    allGroups = result.groups || [];
    allChannels = result.channels || {};

    renderGroupsList();
    renderInventory();
    renderActiveGroupWorkspace();
    updateHeaderStats();
  });
}

function setupEventListeners() {
  // Listen for storage hot-updates (syncs tab across window modifications)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.groups || changes.channels) {
      chrome.storage.local.get(["groups", "channels"], (result) => {
        allGroups = result.groups || [];
        allChannels = result.channels || {};
        
        renderGroupsList();
        renderInventory();
        renderActiveGroupWorkspace();
        updateHeaderStats();
      });
    }
  });

  // Modal Group Trigger
  document.getElementById("btn-add-group").addEventListener("click", () => {
    openGroupModal(null);
  });

  // Modal Cancel Triggers
  document.getElementById("btn-modal-cancel").addEventListener("click", closeGroupModal);
  document.getElementById("btn-manual-cancel").addEventListener("click", closeManualChannelModal);

  // Modal Save Triggers
  document.getElementById("btn-modal-save").addEventListener("click", saveGroupModalData);
  document.getElementById("btn-manual-save").addEventListener("click", saveManualChannelData);

  // Manual Channel Trigger
  document.getElementById("btn-add-channel-manual").addEventListener("click", () => {
    openManualChannelModal();
  });

  // Search Filter
  document.getElementById("inventory-search").addEventListener("input", (e) => {
    searchFilter = e.target.value.toLowerCase();
    renderInventory();
  });

  // Tab buttons
  document.getElementById("tab-all-channels").addEventListener("click", () => {
    setTab("all");
  });
  document.getElementById("tab-unassigned-channels").addEventListener("click", () => {
    setTab("unassigned");
  });

  // Active Group Modifier Buttons
  document.getElementById("btn-edit-group").addEventListener("click", () => {
    if (activeGroupId) openGroupModal(activeGroupId);
  });
  document.getElementById("btn-delete-group").addEventListener("click", deleteActiveGroup);

  // Backup actions
  document.getElementById("btn-export").addEventListener("click", exportBackupData);
  
  const fileInput = document.getElementById("import-file-input");
  document.getElementById("btn-import-trigger").addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", importBackupData);
}

// -------------------------------------------------------------
// RENDER GROUPS SECTION (LEFT PANEL)
// -------------------------------------------------------------

function renderGroupsList() {
  const container = document.getElementById("groups-list");
  if (!container) return;

  if (allGroups.length === 0) {
    container.innerHTML = `
      <div style="padding: 30px 10px; color: var(--text-dark); text-align: center; font-style: italic;">
        No groups created yet. Click "+" to start!
      </div>
    `;
    return;
  }

  let html = "";
  allGroups.forEach(group => {
    const isSelected = group.id === activeGroupId;
    const count = group.channelIds ? group.channelIds.length : 0;
    
    html += `
      <div class="group-list-item glass-card ${isSelected ? 'active' : ''}" 
           data-group-id="${group.id}" 
           style="--group-color: ${group.color}">
        <div class="group-item-inner">
          <span class="group-color-dot" style="background-color: hsl(${group.color})"></span>
          <div class="group-info">
            <span class="group-name-text">${group.name}</span>
            <span class="group-members-count">${count} channels</span>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add click & Drag-and-Drop dropzone capabilities to group items
  container.querySelectorAll(".group-list-item").forEach(item => {
    const groupId = item.getAttribute("data-group-id");

    item.addEventListener("click", () => {
      activeGroupId = groupId;
      renderGroupsList();
      renderActiveGroupWorkspace();
    });

    // Drag and Drop (Inventory -> Group Assignment)
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.classList.add("drag-hover");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-hover");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-hover");
      
      const channelId = e.dataTransfer.getData("text/plain");
      if (channelId) {
        assignChannelToGroup(channelId, groupId);
      }
    });
  });
}

function assignChannelToGroup(channelId, groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) return;

  if (!group.channelIds) group.channelIds = [];
  
  if (group.channelIds.includes(channelId)) {
    alert(`Channel is already in "${group.name}"!`);
    return;
  }

  group.channelIds.push(channelId);

  chrome.storage.local.set({ groups: allGroups }, () => {
    console.log(`SubSphere: Assigned ${channelId} to ${group.name}`);
  });
}

// -------------------------------------------------------------
// RENDER INVENTORY SECTION (MIDDLE PANEL)
// -------------------------------------------------------------

function setTab(tabName) {
  currentTab = tabName;
  document.getElementById("tab-all-channels").classList.toggle("active", tabName === "all");
  document.getElementById("tab-unassigned-channels").classList.toggle("active", tabName === "unassigned");
  renderInventory();
}

function renderInventory() {
  const container = document.getElementById("inventory-grid");
  if (!container) return;

  const channelKeys = Object.keys(allChannels);

  if (channelKeys.length === 0) {
    container.innerHTML = `
      <div class="inventory-empty-state" style="padding: 40px 20px; max-width: 320px; margin: 0 auto;">
        <span style="font-size: 42px; margin-bottom: 16px; display: block;">📺</span>
        <p style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 12px;">Sync your Subscriptions / Kanäle synchronisieren</p>
        <div class="sync-steps-guide" style="text-align: left; font-size: 12px; color: var(--text-muted); line-height: 1.6; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; gap: 8px;"><b style="color: #c084fc;">1.</b> <span>Open or refresh <b><a href="https://www.youtube.com" target="_blank" style="color: #c084fc; text-decoration: underline;">YouTube</a></b>. / YouTube in neuem Tab öffnen.</span></div>
          <div style="display: flex; gap: 8px;"><b style="color: #c084fc;">2.</b> <span>Expand your subscriptions in the left sidebar (click <b>"Show more"</b> / <b>"Mehr anzeigen"</b>). / Linke Sidebar aufklappen.</span></div>
          <div style="display: flex; gap: 8px;"><b style="color: #c084fc;">3.</b> <span>Refresh this Dashboard! Your channels will load instantly. / Dieses Dashboard neu laden!</span></div>
        </div>
        <div style="margin-top: 20px; border-top: 1px solid var(--border-glass); padding-top: 16px; width: 100%;">
          <span style="font-size: 11px; color: var(--text-dark); display: block; margin-bottom: 10px;">Or add your first channel manually:</span>
          <button class="btn btn-secondary btn-full" onclick="document.getElementById('btn-add-channel-manual').click()">+ Add Channel Manually</button>
        </div>
      </div>
    `;
    document.getElementById("inventory-stats").innerText = "0 total";
    return;
  }

  // Get list of all organized channels
  const organizedIds = new Set();
  allGroups.forEach(g => {
    if (g.channelIds) {
      g.channelIds.forEach(id => organizedIds.add(id));
    }
  });

  // Filter channels
  let filteredChannels = channelKeys.map(key => allChannels[key]);

  // Tab Filter
  if (currentTab === "unassigned") {
    filteredChannels = filteredChannels.filter(c => !organizedIds.has(c.id));
  }

  // Search Filter
  if (searchFilter) {
    filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(searchFilter));
  }

  document.getElementById("inventory-stats").innerText = `${filteredChannels.length} shown (${channelKeys.length} total)`;

  if (filteredChannels.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-dark); font-style: italic;">
        No channels match filters.
      </div>
    `;
    return;
  }

  let html = "";
  filteredChannels.forEach(chan => {
    // Find groups this channel belongs to
    const memberGroups = allGroups.filter(g => g.channelIds && g.channelIds.includes(chan.id));
    let badgesHtml = "";
    memberGroups.forEach(g => {
      badgesHtml += `<span class="tag-badge" style="background-color: hsl(${g.color}); filter: brightness(1.2)"></span>`;
    });

    html += `
      <div class="inventory-card glass-card animate-slide-up" 
           draggable="true" 
           data-channel-id="${chan.id}">
        <button class="btn-delete-channel-inventory" data-channel-id="${chan.id}" title="Remove Channel completely from SubSphere" style="position: absolute; top: 6px; left: 6px; background: transparent; border: none; cursor: pointer; color: var(--text-dark); opacity: 0; transition: opacity var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; z-index: 5;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>

        <div class="drag-indicator">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="19" r="2"/>
            <circle cx="16" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="19" r="2"/>
          </svg>
        </div>
        
        <div class="chan-avatar-container">
          ${chan.avatar ? `<img class="chan-avatar" src="${chan.avatar}" alt="${chan.name}" loading="lazy">` : `<div class="chan-avatar-placeholder">${chan.name.charAt(0).toUpperCase()}</div>`}
        </div>

        <div class="chan-details">
          <span class="chan-name" title="${chan.name}">${chan.name}</span>
          <div class="chan-tags-badges">
            ${badgesHtml || '<span class="unassigned-badge">unassigned</span>'}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add click listeners to delete buttons
  container.querySelectorAll(".btn-delete-channel-inventory").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const channelId = btn.getAttribute("data-channel-id");
      deleteChannelCompletely(channelId);
    });
  });

  // Add drag event listeners
  container.querySelectorAll(".inventory-card").forEach(card => {
    const channelId = card.getAttribute("data-channel-id");

    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", channelId);
      e.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });
  });
}

// -------------------------------------------------------------
// COLUMN 3: SELECTED GROUP WORKSPACE & DRAG REORDERING
// -------------------------------------------------------------

function renderActiveGroupWorkspace() {
  const emptyHint = document.getElementById("organizer-empty-hint");
  const workspaceArea = document.getElementById("organizer-workspace-area");
  const actionsBar = document.getElementById("organizer-actions-bar");

  if (!activeGroupId) {
    emptyHint.style.display = "flex";
    workspaceArea.style.display = "none";
    actionsBar.style.display = "none";
    document.getElementById("active-group-name").innerText = "Select a Group";
    document.getElementById("active-group-dot").style.backgroundColor = "transparent";
    return;
  }

  const group = allGroups.find(g => g.id === activeGroupId);
  if (!group) {
    activeGroupId = null;
    renderActiveGroupWorkspace();
    return;
  }

  // Active group selected
  emptyHint.style.display = "none";
  workspaceArea.style.display = "flex";
  actionsBar.style.display = "flex";
  
  document.getElementById("active-group-name").innerText = group.name;
  document.getElementById("active-group-dot").style.backgroundColor = `hsl(${group.color})`;

  renderManualSortingList(group);
  setupDropZoneOverlay(group);
}

function renderManualSortingList(group) {
  const listContainer = document.getElementById("sorting-list");
  if (!listContainer) return;

  const channelIds = group.channelIds || [];

  if (channelIds.length === 0) {
    listContainer.innerHTML = `
      <div class="sorting-empty-state">
        <p>No Channels in this Group</p>
        <span class="sub-text">Drag channels from the inventory on the left and drop them in this workspace!</span>
      </div>
    `;
    return;
  }

  let html = "";
  channelIds.forEach((chanId, index) => {
    const chan = allChannels[chanId] || { id: chanId, name: "Unknown Channel", avatar: "" };

    html += `
      <div class="sorting-item glass-card" 
           draggable="true" 
           data-channel-id="${chan.id}" 
           data-index="${index}">
        <div class="item-drag-handle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="19" r="2"/>
            <circle cx="16" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="19" r="2"/>
          </svg>
        </div>

        <div class="item-avatar-col">
          ${chan.avatar ? `<img class="item-avatar" src="${chan.avatar}" alt="${chan.name}">` : `<div class="item-avatar-placeholder">${chan.name.charAt(0).toUpperCase()}</div>`}
        </div>

        <div class="item-name-col">
          <span class="item-name" title="${chan.name}">${chan.name}</span>
        </div>

        <div class="item-actions-col">
          <button class="btn-remove-from-group" data-channel-id="${chan.id}" title="Remove from Group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  listContainer.innerHTML = html;

  // Add remove button actions
  listContainer.querySelectorAll(".btn-remove-from-group").forEach(btn => {
    btn.addEventListener("click", () => {
      const channelId = btn.getAttribute("data-channel-id");
      removeChannelFromGroup(channelId, group.id);
    });
  });

  // Setup drag-and-drop manual list reordering
  setupSortingReorderEvents(listContainer, group);
}

function removeChannelFromGroup(channelId, groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) return;

  group.channelIds = group.channelIds.filter(id => id !== channelId);

  chrome.storage.local.set({ groups: allGroups }, () => {
    console.log(`SubSphere: Removed channel ${channelId} from group ${group.name}`);
  });
}

// -------------------------------------------------------------
// PURE JS MANUAL REORDER DRAG AND DROP
// -------------------------------------------------------------

function setupSortingReorderEvents(container, group) {
  let draggedEl = null;

  container.querySelectorAll(".sorting-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
      draggedEl = item;
      item.classList.add("reordering");
      e.dataTransfer.effectAllowed = "move";
      e.stopPropagation();
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("reordering");
      
      // Clear visual drops
      container.querySelectorAll(".sorting-item").forEach(i => {
        i.classList.remove("drag-over-top");
        i.classList.remove("drag-over-bottom");
      });
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedEl || draggedEl === item) return;

      const rect = item.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      if (relativeY < rect.height / 2) {
        item.classList.add("drag-over-top");
        item.classList.remove("drag-over-bottom");
      } else {
        item.classList.add("drag-over-bottom");
        item.classList.remove("drag-over-top");
      }
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over-top");
      item.classList.remove("drag-over-bottom");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!draggedEl || draggedEl === item) return;

      const fromIndex = parseInt(draggedEl.getAttribute("data-index"));
      const toIndex = parseInt(item.getAttribute("data-index"));
      
      const rect = item.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      
      let targetIndex = toIndex;
      if (fromIndex < toIndex) {
        // Dragging downwards
        if (relativeY < rect.height / 2) {
          targetIndex = toIndex - 1;
        }
      } else {
        // Dragging upwards
        if (relativeY >= rect.height / 2) {
          targetIndex = toIndex + 1;
        }
      }

      // Reorder items in array
      const reorderedIds = [...group.channelIds];
      const [removed] = reorderedIds.splice(fromIndex, 1);
      reorderedIds.splice(targetIndex, 0, removed);

      group.channelIds = reorderedIds;

      chrome.storage.local.set({ groups: allGroups }, () => {
        console.log(`SubSphere: Reordered channel elements manually inside ${group.name}!`);
      });
    });
  });
}

function setupDropZoneOverlay(group) {
  const overlay = document.getElementById("organizer-workspace-area");

  overlay.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.getElementById("drop-zone-overlay").classList.add("active");
  });

  overlay.addEventListener("dragleave", () => {
    document.getElementById("drop-zone-overlay").classList.remove("active");
  });

  overlay.addEventListener("drop", (e) => {
    e.preventDefault();
    document.getElementById("drop-zone-overlay").classList.remove("active");
    
    // Check if dragging inventory channel (rather than sorting-item)
    const channelId = e.dataTransfer.getData("text/plain");
    // Ensure we are dropping from inventory grid (sorting items handle dropping inside custom callbacks)
    if (channelId && !e.target.closest('.sorting-item')) {
      assignChannelToGroup(channelId, group.id);
    }
  });
}

// -------------------------------------------------------------
// POPULATE STATS
// -------------------------------------------------------------

function updateHeaderStats() {
  const count = Object.keys(allChannels).length;
  document.getElementById("sync-count").innerText = `${count} Synced Subscriptions`;
}

// -------------------------------------------------------------
// MODAL: CREATE/EDIT GROUP ACTIONS
// -------------------------------------------------------------

function openGroupModal(groupId = null) {
  editingGroupId = groupId;
  const modal = document.getElementById("group-modal");
  const modalTitle = document.getElementById("modal-title");
  const nameInput = document.getElementById("group-input-name");

  // Load Colors Presets Grid
  const palette = modal.querySelector(".color-palette-grid");
  let colorsHtml = "";
  hslColorsPreset.forEach(color => {
    colorsHtml += `
      <button class="color-btn" 
              data-color="${color}" 
              style="background-color: hsl(${color})">
      </button>
    `;
  });
  palette.innerHTML = colorsHtml;

  // Add click presets events
  palette.querySelectorAll(".color-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      selectPresetColor(btn);
    });
  });

  if (editingGroupId) {
    // Edit existing group
    const group = allGroups.find(g => g.id === editingGroupId);
    modalTitle.innerText = "Modify Subscription Group";
    nameInput.value = group.name;
    selectedModalColor = group.color;
  } else {
    // Create new group
    modalTitle.innerText = "Create Subscription Group";
    nameInput.value = "";
    selectedModalColor = hslColorsPreset[0];
  }

  // Pre-select button highlight
  const targetBtn = Array.from(palette.querySelectorAll(".color-btn")).find(b => b.getAttribute("data-color") === selectedModalColor);
  if (targetBtn) selectPresetColor(targetBtn);

  modal.classList.add("active");
  nameInput.focus();
}

function selectPresetColor(btnElement) {
  document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
  btnElement.classList.add("active");
  selectedModalColor = btnElement.getAttribute("data-color");
}

function closeGroupModal() {
  document.getElementById("group-modal").classList.remove("active");
  editingGroupId = null;
}

function saveGroupModalData() {
  const nameInput = document.getElementById("group-input-name");
  const nameValue = nameInput.value.trim();

  if (!nameValue) {
    alert("Group Name cannot be empty!");
    return;
  }

  if (editingGroupId) {
    // Update existing group
    const group = allGroups.find(g => g.id === editingGroupId);
    group.name = nameValue;
    group.color = selectedModalColor;
  } else {
    // Create new group
    const newGroup = {
      id: "group_" + Date.now(),
      name: nameValue,
      color: selectedModalColor,
      channelIds: []
    };
    allGroups.push(newGroup);
  }

  chrome.storage.local.set({ groups: allGroups }, () => {
    closeGroupModal();
    console.log("SubSphere: Saved subscription groups layout!");
  });
}

function deleteActiveGroup() {
  if (!activeGroupId) return;

  const group = allGroups.find(g => g.id === activeGroupId);
  if (confirm(`Are you absolutely sure you want to delete group "${group.name}"? Channels inside will not be deleted.`)) {
    allGroups = allGroups.filter(g => g.id !== activeGroupId);
    activeGroupId = null;
    chrome.storage.local.set({ groups: allGroups }, () => {
      console.log("SubSphere: Deleted subscription group.");
    });
  }
}

// -------------------------------------------------------------
// MODAL: ADD CHANNEL MANUALLY ACTIONS
// -------------------------------------------------------------

function openManualChannelModal() {
  document.getElementById("manual-channel-modal").classList.add("active");
  document.getElementById("manual-channel-url").value = "";
  document.getElementById("manual-channel-name").value = "";
  document.getElementById("manual-channel-url").focus();
}

function closeManualChannelModal() {
  document.getElementById("manual-channel-modal").classList.remove("active");
}

async function saveManualChannelData() {
  const urlInput = document.getElementById("manual-channel-url");
  const nameInput = document.getElementById("manual-channel-name");

  const rawUrl = urlInput.value.trim();
  let manualName = nameInput.value.trim();

  if (!rawUrl) {
    alert("Please provide a YouTube Channel URL or @handle.");
    return;
  }

  // Parse details out of YouTube URL
  let resolvedId = "";
  let isHandle = false;

  if (rawUrl.includes("youtube.com/channel/")) {
    resolvedId = rawUrl.split("youtube.com/channel/")[1].split("/")[0].split("?")[0];
  } else if (rawUrl.includes("youtube.com/@")) {
    resolvedId = "@" + rawUrl.split("youtube.com/@")[1].split("/")[0].split("?")[0];
    isHandle = true;
  } else if (rawUrl.startsWith("@")) {
    resolvedId = rawUrl;
    isHandle = true;
  } else if (rawUrl.startsWith("UC") && rawUrl.length >= 24) {
    // Raw Channel ID pasted
    resolvedId = rawUrl;
  } else {
    // Direct string typed, check if look like custom handle
    resolvedId = "@" + rawUrl.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    isHandle = true;
  }

  if (!resolvedId) {
    alert("Could not extract a valid YouTube Channel ID or handle. Check the link format.");
    return;
  }

  // Formulate a beautiful default name if blank
  if (!manualName) {
    manualName = isHandle ? resolvedId : "YouTube Channel";
  }

  // Register in local inventory
  allChannels[resolvedId] = {
    id: resolvedId,
    name: manualName,
    avatar: "" // Blank avatar triggers colorful custom letter badges natively
  };

  chrome.storage.local.set({ channels: allChannels }, () => {
    closeManualChannelModal();
    console.log(`SubSphere: Manually added channel: ${manualName} (${resolvedId})`);
    
    // Proactively launch handles background resolver to load avatar and correct ID
    if (isHandle) {
      resolveManualHandleDetails(resolvedId);
    }
  });
}

// Background resolver for manual handles to extract avatar & real channel ID
async function resolveManualHandleDetails(handle) {
  try {
    console.log(`Resolving details for manual handle: ${handle}`);
    const res = await fetch(`https://www.youtube.com/${handle}`);
    const htmlText = await res.text();

    let name = allChannels[handle]?.name || handle;
    let avatar = "";
    let realId = "";

    // 1. Resolve Channel ID
    const idMatch = htmlText.match(/<meta itemprop="channelId" content="(UC[^"]+)"/);
    if (idMatch && idMatch[1]) {
      realId = idMatch[1];
    }

    // 2. Resolve Name
    const nameMatch = htmlText.match(/<meta itemprop="name" content="([^"]+)"/);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1];
    }

    // 3. Resolve Avatar
    const avatarMatch = htmlText.match(/<meta property="og:image" content="([^"]+)"/);
    if (avatarMatch && avatarMatch[1]) {
      avatar = avatarMatch[1];
    }

    if (realId) {
      // Create new clean inventory reference mapped to proper ID
      allChannels[realId] = {
        id: realId,
        name: name,
        avatar: avatar,
        resolvedId: realId
      };

      // Also map the original handle in memory so any reference works
      allChannels[handle] = {
        id: handle,
        name: name,
        avatar: avatar,
        resolvedId: realId
      };

      // If this handle was added to any groups, replace handle reference with the real ID!
      let groupsUpdated = false;
      allGroups.forEach(g => {
        if (g.channelIds && g.channelIds.includes(handle)) {
          g.channelIds = g.channelIds.map(id => id === handle ? realId : id);
          groupsUpdated = true;
        }
      });

      const payload = { channels: allChannels };
      if (groupsUpdated) payload.groups = allGroups;

      chrome.storage.local.set(payload, () => {
        console.log(`Successfully resolved and updated manual handle ${handle} -> ${realId}`);
      });
    }
  } catch (error) {
    console.error(`Failed to background resolve manual handle ${handle}:`, error);
  }
}

// -------------------------------------------------------------
// BACKUP EXPORT & IMPORT UTILITIES
// -------------------------------------------------------------

function exportBackupData() {
  chrome.storage.local.get(["groups", "channels"], (result) => {
    const backupObj = {
      app: "SubSphere",
      version: "1.0.0",
      timestamp: Date.now(),
      groups: result.groups || [],
      channels: result.channels || {}
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `subsphere_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });
}

function importBackupData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const parsed = JSON.parse(event.target.result);
      
      // Validate Backup Schema
      if (parsed.app !== "SubSphere" || !parsed.groups || !parsed.channels) {
        alert("Invalid file structure. Make sure you upload a valid SubSphere backup JSON!");
        return;
      }

      if (confirm(`Do you want to restore this backup? This will merge ${parsed.groups.length} groups and ${Object.keys(parsed.channels).length} channels with your existing settings.`)) {
        // Merge Logic
        chrome.storage.local.get(["groups", "channels"], (current) => {
          const currentGroups = current.groups || [];
          const currentChannels = current.channels || {};

          // Merge Channels Cache
          const mergedChannels = { ...currentChannels, ...parsed.channels };

          // Merge Groups List (Replace groups with matching IDs, append new ones)
          const mergedGroups = [...currentGroups];
          parsed.groups.forEach(importedGroup => {
            const index = mergedGroups.findIndex(g => g.id === importedGroup.id);
            if (index !== -1) {
              mergedGroups[index] = importedGroup; // Overwrite
            } else {
              mergedGroups.push(importedGroup); // Append
            }
          });

          chrome.storage.local.set({
            groups: mergedGroups,
            channels: mergedChannels
          }, () => {
            alert("Backup successfully restored!");
            // Reset active group to refresh layout
            activeGroupId = null;
            loadData();
          });
        });
      }
    } catch (err) {
      alert("Failed to parse JSON file: " + err.message);
    }
  };

  reader.readAsText(file);
}

// Remove channel entirely from the SubSphere database (inventory & all groups)
function deleteChannelCompletely(channelId) {
  const chanName = allChannels[channelId]?.name || "this channel";
  if (confirm(`Remove "${chanName}" completely from your inventory and all groups?`)) {
    // 1. Delete from channels dictionary
    delete allChannels[channelId];
    
    // 2. Remove from all groups channelIds lists
    allGroups.forEach(g => {
      if (g.channelIds) {
        g.channelIds = g.channelIds.filter(id => id !== channelId);
      }
    });

    // 3. Save to storage
    chrome.storage.local.set({
      channels: allChannels,
      groups: allGroups
    }, () => {
      console.log(`SubSphere: Completely deleted channel ${channelId} from database!`);
    });
  }
}

