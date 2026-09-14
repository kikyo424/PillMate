import webPush from "web-push";

const keys = webPush.generateVAPIDKeys();

console.log("apps/server/.env에 아래 값을 추가하세요.\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
