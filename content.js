(function () {
  if (window.__ogTimeTabContent) return;

  let contextDead = false;

  let cfg = {
    mouseDistanceThreshold: 50,
    mouseWindowMs: 5000,
    trackKeyboard: true,
    trackScroll: true
  };

  let mouseDistance = 0;
  let mouseWindowStart = Date.now();
  let lastX = null;
  let lastY = null;
  let throttleUntil = 0;

  const LISTENER_OPTS = { passive: true, capture: true };

  function markContextDead() {
    if (contextDead) return;
    contextDead = true;
    unbindListeners();
    if (onMessageListener) {
      try {
        chrome.runtime.onMessage.removeListener(onMessageListener);
      } catch {
        /* contexte déjà invalidé */
      }
      onMessageListener = null;
    }
  }

  function isExtensionAlive() {
    if (contextDead) return false;
    try {
      const id = chrome.runtime.id;
      if (!id) {
        markContextDead();
        return false;
      }
      return true;
    } catch {
      markContextDead();
      return false;
    }
  }

  function safeSendMessage(message, callback) {
    if (contextDead) {
      if (typeof callback === "function") {
        try {
          callback(undefined);
        } catch {
          markContextDead();
        }
      }
      return Promise.resolve();
    }
    if (!isExtensionAlive()) {
      if (typeof callback === "function") {
        try {
          callback(undefined);
        } catch {
          markContextDead();
        }
      }
      return Promise.resolve();
    }
    try {
      if (typeof callback === "function") {
        chrome.runtime.sendMessage(message, (res) => {
          if (contextDead) return;
          try {
            if (chrome.runtime.lastError) {
              markContextDead();
              return;
            }
            callback(res);
          } catch {
            markContextDead();
          }
        });
        return Promise.resolve();
      }
      return chrome.runtime.sendMessage(message).catch(() => {
        markContextDead();
      });
    } catch {
      markContextDead();
      return Promise.resolve();
    }
  }

  function sendActivity(score) {
    if (contextDead) return;
    if (!isExtensionAlive()) return;
    const now = Date.now();
    if (now < throttleUntil) return;
    throttleUntil = now + 300;
    void safeSendMessage({ type: "ACTIVITY", score });
  }

  function onMouseMove(e) {
    if (contextDead) return;
    if (!document.defaultView) return;
    if (lastX !== null) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      mouseDistance += Math.hypot(dx, dy);
    }
    lastX = e.clientX;
    lastY = e.clientY;

    const now = Date.now();
    if (now - mouseWindowStart > cfg.mouseWindowMs) {
      mouseDistance = 0;
      mouseWindowStart = now;
    }
    if (mouseDistance >= cfg.mouseDistanceThreshold) {
      mouseDistance = 0;
      mouseWindowStart = now;
      sendActivity(1);
    }
  }

  function onKeyDown() {
    if (contextDead) return;
    if (!cfg.trackKeyboard) return;
    sendActivity(1);
  }

  function onScroll() {
    if (contextDead) return;
    if (!cfg.trackScroll) return;
    sendActivity(1);
  }

  function onPointerOrClick() {
    if (contextDead) return;
    sendActivity(1);
  }

  function unbindListeners() {
    if (!window.__ogTimeTabListenersBound) return;
    window.__ogTimeTabListenersBound = false;
    document.removeEventListener("mousemove", onMouseMove, LISTENER_OPTS);
    window.removeEventListener("mousemove", onMouseMove, LISTENER_OPTS);
    document.removeEventListener("keydown", onKeyDown, LISTENER_OPTS);
    document.removeEventListener("scroll", onScroll, LISTENER_OPTS);
    window.removeEventListener("scroll", onScroll, LISTENER_OPTS);
    window.removeEventListener("wheel", onScroll, LISTENER_OPTS);
    document.removeEventListener("pointerdown", onPointerOrClick, LISTENER_OPTS);
    document.removeEventListener("click", onPointerOrClick, LISTENER_OPTS);
  }

  function bindListeners() {
    if (contextDead) return;
    if (window.__ogTimeTabListenersBound) return;
    if (!document.documentElement) return;
    window.__ogTimeTabListenersBound = true;
    document.addEventListener("mousemove", onMouseMove, LISTENER_OPTS);
    window.addEventListener("mousemove", onMouseMove, LISTENER_OPTS);
    document.addEventListener("keydown", onKeyDown, LISTENER_OPTS);
    document.addEventListener("scroll", onScroll, LISTENER_OPTS);
    window.addEventListener("scroll", onScroll, LISTENER_OPTS);
    window.addEventListener("wheel", onScroll, LISTENER_OPTS);
    document.addEventListener("pointerdown", onPointerOrClick, LISTENER_OPTS);
    document.addEventListener("click", onPointerOrClick, LISTENER_OPTS);
  }

  function requestConfig() {
    if (contextDead) return;
    if (!isExtensionAlive()) return;
    safeSendMessage({ type: "GET_CONFIG" }, (res) => {
      if (contextDead || !res?.config) return;
      cfg = { ...cfg, ...res.config };
    });
  }

  let onMessageListener = null;

  onMessageListener = (msg) => {
    if (contextDead) return;
    try {
      if (!isExtensionAlive()) return;
      if (msg.type === "CONFIG_UPDATED" && msg.config) {
        cfg = { ...cfg, ...msg.config };
      }
    } catch {
      markContextDead();
    }
  };

  bindListeners();
  window.__ogTimeTabContent = true;

  try {
    chrome.runtime.onMessage.addListener(onMessageListener);
  } catch {
    markContextDead();
  }

  if (!contextDead) {
    requestConfig();
  }
})();
