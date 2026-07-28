const tabStates = {};
const lastToggleAt = {};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await toggleTab(tab.id, "line");
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return;
  const tabId = sender.tab.id;

  if (message?.type === "savage_deactivated") {
    tabStates[tabId] = { active: false, tool: tabStates[tabId]?.tool || "line" };
    chrome.action.setIcon({
      path: {
        "16": "images/icon16.png",
        "32": "images/icon32.png",
        "48": "images/icon48.png",
        "128": "images/icon128.png"
      },
      tabId
    }).catch(() => {});
    return;
  }

  if (message?.type === "savage_toggle_shortcut") {
    toggleTab(tabId, "line").catch((err) => {
      console.error ("Shortcut toggle error:", err);
    });
    return;
  }
  if (message?.type !== "savage_tool_changed") return;
  if (!tabStates[tabId]) tabStates[tabId] = { active: true };
  tabStates[tabId].active = true;
  tabStates[tabId].tool = message.tool;
});

async function toggleTab(tabId, tool = "line") {
  const now = Date.now();
  if (lastToggleAt[tabId] && now - lastToggleAt[tabId] < 400) return;
  lastToggleAt[tabId] = now;

  if (!tabStates[tabId]) tabStates[tabId] = { active: false };

  const isActive = tabStates[tabId].active;

  try {
    if (!isActive) {
      // Check if tab URL is accessible before activating
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
        console.warn("Cannot activate extension on restricted URL:", tab.url);
        return;
      }
      await activateTab(tabId, tool);
    } else {
      await deactivateTab(tabId);
    }
  } catch (err) {
    console.error("Toggle error:", err);
    tabStates[tabId].active = false;
  }
}

async function activateTab(tabId, tool) {
  tabStates[tabId] = { active: true, tool };

  await chrome.action.setIcon({
    path: { 
      "16": "images/icon_active16.png", 
      "32": "images/icon_active32.png", 
      "48": "images/icon_active48.png", 
      "128": "images/icon_active128.png" 
    },
    tabId
  });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (initialTool) => {
      window.__savageInitialTool = initialTool;
    },
    args: [tool]
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] });
}

async function deactivateTab(tabId) {
  try {
    // Reset icon
    await chrome.action.setIcon({
      path: { 
        "16": "images/icon16.png", 
        "32": "images/icon32.png", 
        "48": "images/icon48.png", 
        "128": "images/icon128.png" 
      },
      tabId
    });

    // Remove CSS
    await chrome.scripting.removeCSS({ target: { tabId }, files: ["styles.css"] }).catch(() => {});

    // Execute cleanup in tab - MUST remove block overlay
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__savageDeactivate === "function") {
          window.__savageDeactivate({ notify: false });
          return;
        }

        window.__savageActive = false;

        const ids = ['savage-block', 'savage-overlay', 'savage-toolbar', 'savage-info'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (el && el.parentNode) {
            el.parentNode.removeChild(el);
          }
        });

        document.body.classList.remove("savage-active");
        document.body.style.cursor = '';
      }
    }).catch(() => {});

  } catch (e) {
    console.error("Deactivation error:", e);
  }

  if (tabStates[tabId]) tabStates[tabId].active = false;
}

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
  delete lastToggleAt[tabId];
});

// Handle navigation - deactivate before page change
chrome.webNavigation?.onBeforeNavigate?.addListener((details) => {
  if (details.frameId === 0 && tabStates[details.tabId]?.active) {
    deactivateTab(details.tabId).catch(() => {});
  }
});
