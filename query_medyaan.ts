import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function check() {
  const usersSnap = await getDocs(collection(db, "users"));
  let medyaanUsers = 0;
  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (JSON.stringify(data).toLowerCase().includes("medyaan.com")) {
      medyaanUsers++;
      console.log(`User match: ${d.id}`, data);
    }
  });

  const auditSnap = await getDocs(collection(db, "audit_log"));
  let medyaanAudits = 0;
  auditSnap.docs.forEach(d => {
    const data = d.data();
    if (JSON.stringify(data).toLowerCase().includes("medyaan.com")) {
      medyaanAudits++;
      console.log(`Audit match: ${d.id}`, data);
    }
  });

  console.log(`Total medyaan users in Firestore: ${medyaanUsers}`);
  console.log(`Total medyaan audit logs in Firestore: ${medyaanAudits}`);
  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
