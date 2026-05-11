// TouchDesigner Web Server DAT settings.
// By default this follows the page host/port, matching Torin's single-port
// HTTP + WebSocket pattern. Override these only if your TD network requires it.
export const WEBSOCKET_HOST = window.location.hostname || "localhost";
export const WEBSOCKET_PORT = Number(window.location.port) || 9981;
export const WEBSOCKET_PATH = "";

const RECONNECT_INTERVAL_MS = 1000;

export class EmotionWebSocket {
  constructor({ onStatusChange, onMessage } = {}) {
    this.url = `ws://${WEBSOCKET_HOST}:${WEBSOCKET_PORT}${WEBSOCKET_PATH}`;
    this.onStatusChange = onStatusChange;
    this.onMessage = onMessage;
    this.socket = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.shouldReconnect = true;
  }

  connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    this.setStatus(false, `connecting to ${this.url}`);
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.setStatus(true, `connected to ${this.url}`);
    });

    this.socket.addEventListener("message", (event) => {
      if (event.data === "ping" && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send("pong");
        return;
      }

      if (this.onMessage) {
        this.onMessage(event.data);
      }
    });

    this.socket.addEventListener("error", () => {
      this.setStatus(false, `connection error, retrying`);
    });

    this.socket.addEventListener("close", () => {
      this.connected = false;
      this.setStatus(false, `disconnected, retrying`);
      this.scheduleReconnect();
    });
  }

  sendJson(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(payload));
    return true;
  }

  scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL_MS);
  }

  setStatus(isConnected, message) {
    this.connected = isConnected;
    if (this.onStatusChange) {
      this.onStatusChange({ connected: isConnected, message });
    }
  }
}
