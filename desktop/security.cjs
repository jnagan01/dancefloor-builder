/* Shared policy for native IPC, navigation and Chromium permission requests. */
function parseWebUrl(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function createDesktopSecurity(appUrl, getWindow) {
  const trusted = parseWebUrl(appUrl);
  if (!trusted) throw new Error("DANCEFLOOR_URL must be a valid HTTP(S) URL without credentials.");
  const isAppUrl = value => {
    const parsed = parseWebUrl(value);
    return Boolean(parsed && parsed.origin === trusted.origin);
  };
  const owns = wc => {
    const win = getWindow();
    return Boolean(win && !win.isDestroyed() && wc && !wc.isDestroyed() && wc === win.webContents);
  };
  const trustedContents = wc => owns(wc) && isAppUrl(wc.getURL()) && isAppUrl(wc.mainFrame?.url);
  const trustedSender = event => Boolean(
    trustedContents(event?.sender) && event.senderFrame &&
    event.senderFrame === event.sender.mainFrame && isAppUrl(event.senderFrame.url)
  );
  function guard(handler) {
    return (event, ...args) => {
      if (!trustedSender(event)) throw new Error("Native access denied: untrusted page or frame.");
      return handler(event, ...args);
    };
  }
  // Playback uses read-audio IPC + Blob URLs, not camera/microphone capture.
  const permissions = new Set(["fileSystem"]);
  function permissionRequest(wc, permission, details) {
    return Boolean(permissions.has(permission) && trustedContents(wc) &&
      details?.isMainFrame === true && isAppUrl(details.requestingUrl));
  }
  function permissionCheck(wc, permission, requestingOrigin, details) {
    return Boolean(permissions.has(permission) && trustedContents(wc) &&
      details?.isMainFrame === true && isAppUrl(requestingOrigin) &&
      (!details.requestingUrl || isAppUrl(details.requestingUrl)));
  }
  function navigation(url) {
    if (isAppUrl(url)) return "app";
    return parseWebUrl(url) ? "external" : "deny";
  }
  return { isAppUrl, trustedSender, guard, permissionRequest, permissionCheck, navigation };
}
module.exports = { parseWebUrl, createDesktopSecurity };