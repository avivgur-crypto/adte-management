/* Service Worker — Web Push notifications */

self.addEventListener("push", (event) => {
  let title = "Notification";
  let body = "";

  if (event.data) {
    try {
      const payload = event.data.json();
      title = typeof payload.title === "string" ? payload.title : title;
      body = typeof payload.body === "string" ? payload.body : String(payload.body ?? "");
    } catch {
      const text = event.data.text();
      try {
        const parsed = JSON.parse(text);
        title = typeof parsed.title === "string" ? parsed.title : title;
        body = typeof parsed.body === "string" ? parsed.body : text;
      } catch {
        body = text;
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
    }),
  );
});
