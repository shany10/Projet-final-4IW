import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

// Demarre un MongoDB jetable en memoire PUIS le backend en dev : le readiness
// check Playwright sur http://localhost:3000/ garantit ainsi que les deux sont
// prets, sans dependre de Docker ni d'identifiants machine. Base vierge a
// chaque run (le bootstrap backend recree le compte admin automatiquement).
// Premier lancement : telechargement du binaire mongod (~90 Mo), ensuite cache.

const backendDir = fileURLToPath(new URL("../../backend", import.meta.url));

const mongo = await MongoMemoryServer.create({
  instance: { dbName: "eatplanner_e2e" }
});
const mongoUri = mongo.getUri("eatplanner_e2e");
console.log(`[e2e] MongoDB embarque pret : ${mongoUri}`);

const child = spawn("npm run dev", {
  cwd: backendDir,
  shell: true,
  stdio: "inherit",
  env: { ...process.env, MONGODB_URI: mongoUri }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", async (code) => {
  await mongo.stop();
  process.exit(code ?? 0);
});
