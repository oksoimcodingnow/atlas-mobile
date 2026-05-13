/**
 * ATLAS Service Worker
 * ====================
 * Lives at /sw.js. The browser registers this file once via app/page.tsx's
 * navigator.serviceWorker.register('/sw.js') call. Once registered, it runs
 * in the background (even when ATLAS isn't open) and can:
 *   - Receive push notifications from our backend
 *   - Wake the device (iOS PWA / Android Chrome)
 *   - Open ATLAS when the notification is tapped
 *
 * Service workers are EVENT-DRIVEN. We listen for:
 *   - 'install'        — fires once when the SW is first registered
 *   - 'activate'       — fires when the SW takes control
 *   - 'push'           — fires when a push notification arrives
 *   - 'notificationclick' — fires when the user taps the notification
 */

self.addEventListener("install", (event) => {
  // Activate immediately, don't wait for old workers
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all open clients without requiring a reload
  event.waitUntil(self.clients.claim());
});

// Push event — fired when the server sends a push notification
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ATLAS", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "ATLAS";
  const options = {
    body: data.body || "New message",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || "atlas-default",
    requireInteraction: !!data.requireInteraction,
    data: {
      url: data.url || "/",
      ...(data.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click on the notification → focus/open ATLAS
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
