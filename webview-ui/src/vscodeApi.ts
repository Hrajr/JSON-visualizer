import type { HostToWebviewMessage, WebviewToHostMessage } from '@shared/messages';

interface VsCodeApi {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

export function postMessage(msg: WebviewToHostMessage): void {
  getVsCodeApi().postMessage(msg);
}

type MessageHandler = (msg: HostToWebviewMessage) => void;
const listeners = new Set<MessageHandler>();

window.addEventListener('message', (ev: MessageEvent<HostToWebviewMessage>) => {
  for (const handler of listeners) {
    handler(ev.data);
  }
});

export function onMessage(handler: MessageHandler): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

let idCounter = 0;
export function nextRequestId(): string {
  return `req_${++idCounter}_${Date.now()}`;
}
