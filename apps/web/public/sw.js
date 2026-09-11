self.addEventListener("push", (event) => {
  const fallback = {
    title: "PillMate",
    body: "새 복약 알림이 있습니다.",
    url: "/"
  };
  const data = event.data ? event.data.json() : fallback;

  event.waitUntil(
    self.registration.showNotification(data.title || fallback.title, {
      body: data.body || fallback.body,
      data: {
        url: data.url || fallback.url
      },
      icon: "/pillmate-icon.svg"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(clients.openWindow(url));
});
