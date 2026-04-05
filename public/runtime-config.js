window.APP_CONFIG = window.APP_CONFIG || {
  // Auto-detect: use LAN IP only inside Capacitor webview, otherwise same-origin
  apiBaseUrl: (function () {
    var isCapacitor = typeof window.Capacitor !== "undefined" ||
      /capacitor/i.test(window.location.protocol) ||
      window.location.protocol === "file:";
    return isCapacitor ? "http://192.168.29.57:3000" : "";
  })()
};
